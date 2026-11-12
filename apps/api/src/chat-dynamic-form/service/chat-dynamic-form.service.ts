import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { LockMode } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import type { EntityRepository } from '@mikro-orm/postgresql';

import {
  dynamicFormRequestSchema,
  type DynamicFormCancelInput,
  type DynamicFormRequestInput,
  type DynamicFormSubmitInput,
} from '../dto/chat-dynamic-form.schema.js';
import type {
  DynamicFormDefinition,
  DynamicFormResponse,
} from '../dto/chat-dynamic-form-response.js';
import { ChatDynamicForm } from '../entity/chat-dynamic-form.entity.js';
import type { DynamicFormContext } from '../port/dynamic-form-handler.port.js';
import { DynamicFormRegistryService } from './dynamic-form-registry.service.js';

const FORM_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ChatDynamicFormService {
  public constructor(
    @InjectRepository(ChatDynamicForm)
    private readonly forms: EntityRepository<ChatDynamicForm>,
    private readonly registry: DynamicFormRegistryService,
  ) {}

  public async request(input: {
    userId: string;
    conversationId: string;
    runId: string;
    input: DynamicFormRequestInput;
  }): Promise<{
    definition: DynamicFormDefinition;
    safeResult: { formId: string; revision: number; status: 'open' };
  }> {
    const parsed = dynamicFormRequestSchema.parse(input.input);
    const context: DynamicFormContext = {
      userId: input.userId,
      conversationId: input.conversationId,
      runId: input.runId,
    };
    const now = new Date();
    const entity = new ChatDynamicForm();
    const prepared = await this.registry.prepare(context, parsed);
    const expiresAt = new Date(now.getTime() + FORM_TTL_MS);
    const definition: DynamicFormDefinition = {
      formId: entity.id,
      formKind: parsed.formKind,
      revision: 1,
      title: prepared.title,
      description: prepared.description,
      fields: prepared.fields,
      submitLabel: prepared.submitLabel,
      status: 'open',
      expiresAt: expiresAt.toISOString(),
    };
    this.registry.assertDefinition(definition);
    Object.assign(entity, {
      userId: input.userId,
      conversationId: input.conversationId,
      runId: input.runId,
      formKind: definition.formKind,
      revision: definition.revision,
      definition,
      handlerContext: prepared.handlerContext ?? {},
      status: definition.status,
      expiresAt,
    });
    this.forms.getEntityManager().persist(entity);
    await this.forms.getEntityManager().flush();
    return {
      definition,
      safeResult: { formId: entity.id, revision: 1, status: 'open' },
    };
  }

  public async get(
    userId: string,
    conversationId: string,
    formId: string,
  ): Promise<DynamicFormResponse> {
    const entity = await this.find(userId, conversationId, formId);
    await this.expireIfNeeded(entity);
    return this.response(entity);
  }

  public async submit(
    userId: string,
    conversationId: string,
    formId: string,
    input: DynamicFormSubmitInput,
  ): Promise<DynamicFormResponse> {
    const manager = this.forms.getEntityManager();
    const submissionFingerprint = createHash('sha256')
      .update(
        JSON.stringify(Object.fromEntries(Object.entries(input.values).sort())),
      )
      .digest('hex');
    return manager.transactional(async (transaction) => {
      const entity = await transaction.findOne(
        ChatDynamicForm,
        { id: formId, userId, conversationId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!entity) throw new NotFoundException('动态表单不存在');
      if (entity.status === 'submitted') {
        if (entity.submissionFingerprint === submissionFingerprint) {
          return this.response(entity);
        }
        throw new ConflictException('动态表单已提交其他内容');
      }
      if (entity.status !== 'open') {
        throw new ConflictException('动态表单状态已变化');
      }
      if (entity.expiresAt <= new Date()) {
        entity.status = 'expired';
        entity.updatedAt = new Date();
        await transaction.flush();
        throw new ConflictException('动态表单已过期');
      }
      if (entity.revision !== input.revision) {
        throw new ConflictException('动态表单版本已变化');
      }
      const handler = this.registry.get(entity.formKind);
      const context: DynamicFormContext = {
        userId,
        conversationId,
        runId: entity.runId,
        handlerContext: entity.handlerContext,
      };
      const validation = await handler.validate(
        context,
        entity.definition,
        input.values,
      );
      if (!validation.ok) {
        throw new UnprocessableEntityException({
          message: '表单字段校验失败',
          issues: validation.issues.map(({ key, code, message }) => ({
            key,
            code,
            message,
          })),
        });
      }
      const result = await handler.submit(
        context,
        entity.definition,
        validation.values,
      );
      entity.status = 'submitted';
      entity.updatedAt = new Date();
      entity.resultReference = result;
      entity.submissionFingerprint = submissionFingerprint;
      await transaction.flush();
      return this.response(entity);
    });
  }

  public async cancel(
    userId: string,
    conversationId: string,
    formId: string,
    input: DynamicFormCancelInput,
  ): Promise<DynamicFormResponse> {
    const manager = this.forms.getEntityManager();
    return manager.transactional(async (transaction) => {
      const entity = await transaction.findOne(
        ChatDynamicForm,
        { id: formId, userId, conversationId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!entity) throw new NotFoundException('动态表单不存在');
      if (entity.revision !== input.revision) {
        throw new ConflictException('动态表单版本已变化');
      }
      if (entity.status === 'open') {
        entity.status = 'cancelled';
        entity.updatedAt = new Date();
        await transaction.flush();
      }
      return this.response(entity);
    });
  }

  private async find(userId: string, conversationId: string, formId: string) {
    const entity = await this.forms.findOne({
      id: formId,
      userId,
      conversationId,
    });
    if (!entity) throw new NotFoundException('动态表单不存在');
    return entity;
  }

  private async expireIfNeeded(entity: ChatDynamicForm): Promise<void> {
    if (entity.status !== 'open' || entity.expiresAt > new Date()) return;
    entity.status = 'expired';
    entity.updatedAt = new Date();
    await this.forms.getEntityManager().flush();
  }

  private response(entity: ChatDynamicForm): DynamicFormResponse {
    return {
      ...entity.definition,
      formId: entity.id,
      revision: entity.revision,
      status: entity.status,
      expiresAt: entity.expiresAt.toISOString(),
      result: entity.resultReference,
    };
  }
}
