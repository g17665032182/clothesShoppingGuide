import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';
import { createHash } from 'node:crypto';

import {
  type CreateMemoryInput,
  type ListMemoryQueryDto,
  type MemoryListResponse,
  type MemorySettingsResponse,
  type UpdateMemoryInput,
  type UpdateMemorySettingsInput,
  toMemoryValue,
} from '../dto/user-memory.dto.js';
import { UserMemory, UserMemoryStatus } from '../entity/user-memory.entity.js';
import {
  UserMemoryTask,
  UserMemoryTaskStatus,
} from '../entity/user-memory-task.entity.js';
import { UserMemorySetting } from '../entity/user-memory-setting.entity.js';
import { toMemoryResponse } from '../entity/user-memory.mapper.js';
import { containsSensitiveMemoryText } from '../context/memory-safety.js';

const SINGLE_VALUE_CATEGORIES = new Set(['size', 'shoe_size', 'fit', 'budget']);

@Injectable()
export class UserMemoryService {
  public constructor(
    @InjectRepository(UserMemory)
    private readonly memories: EntityRepository<UserMemory>,
    @InjectRepository(UserMemorySetting)
    private readonly settings: EntityRepository<UserMemorySetting>,
  ) {}

  public async list(
    userId: string,
    query: ListMemoryQueryDto,
  ): Promise<MemoryListResponse> {
    const where = {
      userId,
      status: UserMemoryStatus.ACTIVE,
      ...(query.category ? { category: query.category } : {}),
    };
    const [items, total, setting] = await Promise.all([
      this.memories.find(where, {
        orderBy: { updatedAt: 'desc' },
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      }),
      this.memories.count(where),
      this.getOrCreateSettings(userId),
    ]);

    return {
      items: items.map(toMemoryResponse),
      settings: this.toSettingsResponse(setting),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  public async create(
    userId: string,
    input: CreateMemoryInput,
  ): Promise<ReturnType<typeof toMemoryResponse>> {
    const value = toMemoryValue(input.category, input.value);
    this.assertSafeValue(value);
    const fingerprint = this.fingerprint(value);
    const em = this.memories.getEntityManager();

    return em.transactional(async (transactionalEm) => {
      const repository = transactionalEm.getRepository(UserMemory);
      const existing = await repository.findOne({
        userId,
        category: input.category,
        valueFingerprint: fingerprint,
        status: UserMemoryStatus.ACTIVE,
      });
      if (existing) return toMemoryResponse(existing);

      if (input.isPrimary && SINGLE_VALUE_CATEGORIES.has(input.category)) {
        await repository.nativeUpdate(
          {
            userId,
            category: input.category,
            status: UserMemoryStatus.ACTIVE,
            isPrimary: true,
          },
          { isPrimary: false },
        );
      }

      const memory = repository.create({
        userId,
        category: input.category,
        value,
        valueType: this.valueType(input.category),
        valueFingerprint: fingerprint,
        isPrimary: input.isPrimary,
        status: UserMemoryStatus.ACTIVE,
        sourceConversationId: null,
        sourceStatus: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await repository.getEntityManager().flush();
      return toMemoryResponse(memory);
    });
  }

  public async update(
    userId: string,
    id: string,
    input: UpdateMemoryInput,
  ): Promise<ReturnType<typeof toMemoryResponse>> {
    const em = this.memories.getEntityManager();
    return em.transactional(async (transactionalEm) => {
      const repository = transactionalEm.getRepository(UserMemory);
      const memory = await repository.findOne({
        id,
        userId,
        status: UserMemoryStatus.ACTIVE,
      });
      if (!memory) throw new NotFoundException('记忆不存在');

      const category = input.category ?? memory.category;
      const value =
        input.value === undefined && input.category === undefined
          ? memory.value
          : toMemoryValue(category, input.value ?? memory.value);
      this.assertSafeValue(value);
      const fingerprint = this.fingerprint(value);

      const duplicate = await repository.findOne({
        userId,
        category,
        valueFingerprint: fingerprint,
        status: UserMemoryStatus.ACTIVE,
      });
      if (duplicate && duplicate.id !== memory.id) {
        throw new BadRequestException('同类记忆已存在');
      }

      const nextIsPrimary = input.isPrimary ?? memory.isPrimary;
      if (nextIsPrimary && SINGLE_VALUE_CATEGORIES.has(category)) {
        await repository.nativeUpdate(
          {
            userId,
            category,
            status: UserMemoryStatus.ACTIVE,
            isPrimary: true,
            id: { $ne: memory.id },
          },
          { isPrimary: false },
        );
      }
      memory.category = category;
      memory.value = value;
      memory.valueType = this.valueType(category);
      memory.valueFingerprint = fingerprint;
      memory.isPrimary = nextIsPrimary;
      await repository.getEntityManager().flush();
      return toMemoryResponse(memory);
    });
  }

  public async delete(userId: string, id: string): Promise<void> {
    const memory = await this.memories.findOne({
      id,
      userId,
      status: UserMemoryStatus.ACTIVE,
    });
    if (!memory) throw new NotFoundException('记忆不存在');
    memory.status = UserMemoryStatus.DELETED;
    memory.deletedAt = new Date();
    await this.memories.getEntityManager().flush();
  }

  public async deleteAll(userId: string): Promise<{ deletedCount: number }> {
    return this.memories.getEntityManager().transactional(async (em) => {
      const repository = em.getRepository(UserMemory);
      const taskRepository = em.getRepository(UserMemoryTask);
      // 先锁定并清理未完成任务；提取事务也锁任务行，避免删除完成后旧结果重新创建记忆。
      await taskRepository.nativeDelete({
        userId,
        status: {
          $in: [
            UserMemoryTaskStatus.PENDING,
            UserMemoryTaskStatus.PROCESSING,
            UserMemoryTaskStatus.FAILED,
          ],
        },
      });
      const memories = await repository.find({
        userId,
        status: UserMemoryStatus.ACTIVE,
      });
      const now = new Date();
      for (const memory of memories) {
        memory.status = UserMemoryStatus.DELETED;
        memory.deletedAt = now;
      }
      await em.flush();
      return { deletedCount: memories.length };
    });
  }

  public async updateSettings(
    userId: string,
    input: UpdateMemorySettingsInput,
  ): Promise<MemorySettingsResponse> {
    const setting = await this.getOrCreateSettings(userId);
    setting.enabled = input.enabled;
    await this.settings.getEntityManager().flush();
    return this.toSettingsResponse(setting);
  }

  public async getSettings(userId: string): Promise<MemorySettingsResponse> {
    return this.toSettingsResponse(await this.getOrCreateSettings(userId));
  }

  private async getOrCreateSettings(
    userId: string,
  ): Promise<UserMemorySetting> {
    let setting = await this.settings.findOne({ userId });
    if (!setting) {
      const now = new Date();
      setting = this.settings.create({
        userId,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });
      await this.settings.getEntityManager().flush();
    }
    return setting;
  }

  private toSettingsResponse(
    setting: UserMemorySetting,
  ): MemorySettingsResponse {
    return {
      enabled: setting.enabled,
      updatedAt: setting.updatedAt.toISOString(),
    };
  }

  private valueType(category: string): 'single' | 'multi' | 'range' {
    if (category === 'budget') return 'range';
    if (SINGLE_VALUE_CATEGORIES.has(category)) return 'single';
    return 'multi';
  }

  private fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private assertSafeValue(value: unknown): void {
    if (containsSensitiveMemoryText(value)) {
      throw new BadRequestException('记忆值包含不允许保存的信息');
    }
  }
}
