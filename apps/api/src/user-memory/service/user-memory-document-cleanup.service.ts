import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import { UserMemoryDocumentState } from '../entity/user-memory-document-state.entity.js';
import { UserMemoryDocumentCleanup } from '../entity/user-memory-document-cleanup.entity.js';
import { UserMemoryDocumentStoreService } from './user-memory-document-store.service.js';

const CLEANUP_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_DELAY_MS = 60 * 60 * 1000;

@Injectable()
export class UserMemoryDocumentCleanupService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(UserMemoryDocumentCleanupService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private marker: string | undefined;

  public constructor(
    @InjectRepository(UserMemoryDocumentCleanup)
    private readonly cleanups: EntityRepository<UserMemoryDocumentCleanup>,
    private readonly store: UserMemoryDocumentStoreService,
  ) {}

  public onModuleInit(): void {
    this.timer = setInterval(() => void this.poll(), RETRY_DELAY_MS);
    this.timer.unref();
    void this.poll();
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  public async trackUploaded(userId: string, objectKey: string): Promise<void> {
    await this.cleanups
      .getEntityManager()
      .fork()
      .transactional(async (em) => {
        await this.schedule(em, userId, objectKey);
      });
  }

  public async schedule(
    em: EntityManager,
    userId: string | null,
    objectKey: string,
  ): Promise<void> {
    const repository = em.getRepository(UserMemoryDocumentCleanup);
    const existing = await repository.findOne({ objectKey });
    const nextAttemptAt = new Date(Date.now() + CLEANUP_DELAY_MS);
    if (existing) {
      existing.userId = userId;
      existing.attempts = 0;
      existing.nextAttemptAt = nextAttemptAt;
    } else {
      repository.create({
        objectKey,
        userId,
        attempts: 0,
        nextAttemptAt,
        createdAt: new Date(),
      });
    }
    await em.flush();
  }

  public async cancel(em: EntityManager, objectKey: string): Promise<void> {
    await em.nativeDelete(UserMemoryDocumentCleanup, { objectKey });
  }

  public async processDueBatch(): Promise<void> {
    const em = this.cleanups.getEntityManager().fork();
    const cleanups = em.getRepository(UserMemoryDocumentCleanup);
    const states = em.getRepository(UserMemoryDocumentState);
    const due = await cleanups.find(
      { nextAttemptAt: { $lte: new Date() } },
      { orderBy: { nextAttemptAt: 'asc' }, limit: 20 },
    );

    for (const cleanup of due) {
      try {
        const current = await states.findOne({ objectKey: cleanup.objectKey });
        if (current) {
          await cleanups.nativeDelete({ id: cleanup.id });
          continue;
        }
        await this.store.deleteObject(cleanup.objectKey);
        await cleanups.nativeDelete({ id: cleanup.id });
      } catch {
        cleanup.attempts += 1;
        cleanup.nextAttemptAt = new Date(Date.now() + RETRY_DELAY_MS);
        await em.flush();
        this.logger.warn('用户记忆对象清理失败，将稍后重试');
      }
    }
  }

  private async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.processDueBatch();
      // 对象上传成功但登记前进程退出时，通过巡检补入清理队列。
      const page = await this.store.listObjects(this.marker);
      const em = this.cleanups.getEntityManager().fork();
      for (const object of page.items) {
        if (object.uploadedAt.getTime() > Date.now() - CLEANUP_DELAY_MS)
          continue;
        const referenced = await em.findOne(UserMemoryDocumentState, {
          objectKey: object.key,
        });
        const queued = await em.findOne(UserMemoryDocumentCleanup, {
          objectKey: object.key,
        });
        if (!referenced && !queued) {
          await this.schedule(em, null, object.key);
        }
      }
      this.marker = page.marker;
    } catch {
      this.logger.warn('用户记忆对象清理巡检失败，将稍后重试');
    } finally {
      this.running = false;
    }
  }
}
