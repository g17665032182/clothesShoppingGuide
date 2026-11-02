import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import type { EntityManager } from '@mikro-orm/core';
import { EntityRepository } from '@mikro-orm/postgresql';
import { createHash } from 'node:crypto';

import {
  memoryDocumentContentSchema,
  type UpdateMemoryDocumentInput,
} from '../context/memory-document.schema.js';
import type { MemoryDocumentOperation } from '../context/memory-document-patch.schema.js';
import { containsSensitiveMemoryText } from '../context/memory-safety.js';
import type { UserMemoryDocumentResponse } from '../dto/user-memory-document.dto.js';
import { UserMemoryDocumentState } from '../entity/user-memory-document-state.entity.js';
import { UserMemoryDocumentTaskResult } from '../entity/user-memory-document-task-result.entity.js';
import { UserMemorySetting } from '../entity/user-memory-setting.entity.js';
import { UserMemoryDocumentCleanupService } from './user-memory-document-cleanup.service.js';
import { UserMemoryDocumentStoreService } from './user-memory-document-store.service.js';

const EMPTY_DOCUMENT_HASH = createHash('sha256').update('').digest('hex');

@Injectable()
export class UserMemoryDocumentService {
  public constructor(
    @InjectRepository(UserMemoryDocumentState)
    private readonly states: EntityRepository<UserMemoryDocumentState>,
    private readonly store: UserMemoryDocumentStoreService,
    private readonly cleanup: UserMemoryDocumentCleanupService,
  ) {}

  public async get(userId: string): Promise<UserMemoryDocumentResponse> {
    return this.withLockedState(userId, async (_entityManager, state) => {
      const content = await this.readCurrentContent(state);
      return this.toResponse(state, content);
    });
  }

  public async update(
    userId: string,
    input: UpdateMemoryDocumentInput,
  ): Promise<UserMemoryDocumentResponse> {
    if (containsSensitiveMemoryText(input.content)) {
      throw new BadRequestException({
        code: 'MEMORY_DOCUMENT_SENSITIVE_CONTENT',
      });
    }

    return this.withLockedState(userId, async (entityManager, state) => {
      if (state.revision !== input.expectedRevision) {
        throw new ConflictException({
          code: 'MEMORY_DOCUMENT_REVISION_CONFLICT',
        });
      }
      if (input.content === '') {
        await this.clearLocked(entityManager, state);
        return this.toResponse(state, '');
      }
      const previousContent = await this.readCurrentContent(state);
      if (input.content === previousContent) {
        return this.toResponse(state, previousContent);
      }

      await this.replaceContent(entityManager, state, input.content);
      return this.toResponse(state, input.content);
    });
  }

  public async clear(userId: string): Promise<void> {
    await this.withLockedState(userId, async (entityManager, state) => {
      await this.clearLocked(entityManager, state);
    });
  }

  public async applyExtractedOperations(input: {
    userId: string;
    taskId: string;
    documentGeneration: number;
    operations: MemoryDocumentOperation[];
  }): Promise<void> {
    if (input.operations.length === 0) return;
    await this.withLockedState(input.userId, async (entityManager, state) => {
      const setting = await entityManager
        .getRepository(UserMemorySetting)
        .findOne({ userId: input.userId });
      if (setting?.enabled === false) return;
      if (state.documentGeneration !== input.documentGeneration) return;

      const existingContent = await this.readCurrentContent(state);
      let nextContent = existingContent;
      const pendingResults: UserMemoryDocumentTaskResult[] = [];
      const pendingKeys = new Set<string>();

      for (const operation of input.operations) {
        const operationKey = this.operationKey(operation);
        if (pendingKeys.has(operationKey)) continue;
        const existing = await entityManager
          .getRepository(UserMemoryDocumentTaskResult)
          .findOne({ taskId: input.taskId, operationKey });
        if (existing) continue;

        const candidateContent = this.applyOperation(nextContent, operation);
        if (!memoryDocumentContentSchema.safeParse(candidateContent).success) {
          continue;
        }
        nextContent = candidateContent;
        const result = entityManager
          .getRepository(UserMemoryDocumentTaskResult)
          .create({
            taskId: input.taskId,
            operationKey,
            appliedAt: new Date(),
          });
        pendingResults.push(result);
        pendingKeys.add(operationKey);
      }

      if (nextContent !== existingContent) {
        if (nextContent === '') {
          await this.clearContent(entityManager, state);
        } else {
          await this.replaceContent(entityManager, state, nextContent);
        }
      }
      for (const result of pendingResults) entityManager.persist(result);
      if (pendingResults.length > 0) await entityManager.flush();
    });
  }

  private async withLockedState<T>(
    userId: string,
    callback: (
      entityManager: EntityManager,
      state: UserMemoryDocumentState,
    ) => Promise<T>,
  ): Promise<T> {
    const entityManager = this.states.getEntityManager();
    return entityManager.transactional(async (transactionalEm) => {
      await transactionalEm
        .getConnection()
        .execute(
          'select pg_advisory_xact_lock(hashtextextended(?, 0))',
          [`user-memory-document:${userId}`],
          'run',
          transactionalEm.getTransactionContext(),
        );

      const repository = transactionalEm.getRepository(UserMemoryDocumentState);
      let state = await repository.findOne({ userId });
      if (!state) {
        state = repository.create({
          userId,
          revision: 0,
          objectKey: null,
          documentGeneration: 0,
          contentHash: EMPTY_DOCUMENT_HASH,
          updatedAt: new Date(),
        });
        transactionalEm.persist(state);
        await transactionalEm.flush();
      }
      return callback(transactionalEm, state);
    });
  }

  private async readCurrentContent(
    state: UserMemoryDocumentState,
  ): Promise<string> {
    if (!state.objectKey) return '';
    try {
      const stored = await this.store.readObject(state.objectKey);
      const content = new TextDecoder('utf-8', { fatal: true }).decode(stored);
      if (this.hash(content) !== state.contentHash) {
        throw new Error('content hash mismatch');
      }
      return content;
    } catch {
      throw new ServiceUnavailableException({
        code: 'MEMORY_DOCUMENT_STORAGE_UNAVAILABLE',
      });
    }
  }

  private async clearLocked(
    entityManager: EntityManager,
    state: UserMemoryDocumentState,
  ): Promise<void> {
    state.documentGeneration += 1;
    await this.clearContent(entityManager, state);
  }

  private async clearContent(
    entityManager: EntityManager,
    state: UserMemoryDocumentState,
  ): Promise<void> {
    const previousObjectKey = state.objectKey;
    if (state.contentHash !== EMPTY_DOCUMENT_HASH) {
      state.revision += 1;
      state.contentHash = EMPTY_DOCUMENT_HASH;
      state.updatedAt = new Date();
    }
    state.objectKey = null;
    if (previousObjectKey) {
      await this.cleanup.schedule(
        entityManager,
        state.userId,
        previousObjectKey,
      );
    }
    await entityManager.flush();
  }

  private async replaceContent(
    entityManager: EntityManager,
    state: UserMemoryDocumentState,
    content: string,
  ): Promise<void> {
    const revision = state.revision + 1;
    let objectKey: string;
    try {
      objectKey = await this.store.putRevision(state.userId, revision, content);
      await this.cleanup.trackUploaded(state.userId, objectKey);
    } catch {
      throw new ServiceUnavailableException({
        code: 'MEMORY_DOCUMENT_STORAGE_UNAVAILABLE',
      });
    }

    const previousObjectKey = state.objectKey;
    state.revision = revision;
    state.objectKey = objectKey;
    state.contentHash = this.hash(content);
    state.updatedAt = new Date();
    await this.cleanup.cancel(entityManager, objectKey);
    if (previousObjectKey && previousObjectKey !== objectKey) {
      await this.cleanup.schedule(
        entityManager,
        state.userId,
        previousObjectKey,
      );
    }
    await entityManager.flush();
  }

  private applyOperation(
    content: string,
    operation: MemoryDocumentOperation,
  ): string {
    if (operation.operation === 'append') {
      const normalized = operation.markdown.trim().replace(/\s+/gu, ' ');
      const existingParagraphs = content
        .replace(/^#{1,6}\s.*$/gmu, '')
        .split(/\n\s*\n/u)
        .map((paragraph) => paragraph.trim().replace(/\s+/gu, ' '));
      if (existingParagraphs.includes(normalized)) return content;
      const heading =
        operation.section === 'clothing' ? '## 服装与购物' : '## 其他偏好';
      const sectionIndex = content.indexOf(`${heading}\n`);
      if (sectionIndex >= 0) {
        const insertionPoint = sectionIndex + heading.length + 1;
        const next = `${content.slice(0, insertionPoint)}\n${operation.markdown}\n${content.slice(insertionPoint)}`;
        return next.trim();
      }
      return `${content.trim()}${content.trim() ? '\n\n' : ''}${heading}\n\n${operation.markdown}`;
    }

    const firstIndex = content.indexOf(operation.targetText);
    if (
      firstIndex < 0 ||
      content.indexOf(operation.targetText, firstIndex + 1) >= 0
    ) {
      return content;
    }
    const endIndex = firstIndex + operation.targetText.length;
    if (operation.operation === 'delete') {
      return `${content.slice(0, firstIndex)}${content.slice(endIndex)}`
        .replace(/\n{3,}/gu, '\n\n')
        .trim();
    }
    return `${content.slice(0, firstIndex)}${operation.replacement}${content.slice(endIndex)}`;
  }

  private operationKey(operation: MemoryDocumentOperation): string {
    return this.hash(JSON.stringify(operation));
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  private toResponse(
    state: UserMemoryDocumentState,
    content: string,
  ): UserMemoryDocumentResponse {
    return {
      content,
      revision: state.revision,
      updatedAt: state.updatedAt?.toISOString() ?? null,
    };
  }
}
