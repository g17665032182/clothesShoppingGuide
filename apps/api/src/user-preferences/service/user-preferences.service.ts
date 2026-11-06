import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';
import { createHash } from 'node:crypto';

import {
  type CreatePreferenceInput,
  type ListPreferenceQuery,
  type PreferenceListResponse,
  type UpdatePreferenceInput,
  toPreferenceValue,
} from '../dto/user-preference.dto.js';
import {
  UserPreference,
  UserPreferenceStatus,
} from '../entity/user-preference.entity.js';
import { toPreferenceResponse } from '../entity/user-preference.mapper.js';
import { containsSensitivePreferenceText } from '../context/preference-safety.js';
import { UserPreferenceSettingsService } from './user-preference-settings.service.js';
import { lockPreferenceUser } from '../task/preference-user-lock.js';

const SINGLE_VALUE_CATEGORIES = new Set(['size', 'shoe_size', 'fit', 'budget']);

@Injectable()
export class UserPreferencesService {
  public constructor(
    @InjectRepository(UserPreference)
    private readonly preferences: EntityRepository<UserPreference>,
    private readonly settings: UserPreferenceSettingsService,
  ) {}

  public async list(
    userId: string,
    query: ListPreferenceQuery,
  ): Promise<PreferenceListResponse> {
    const where = {
      userId,
      status: UserPreferenceStatus.ACTIVE,
      ...(query.category ? { category: query.category } : {}),
    };
    const [items, total, setting] = await Promise.all([
      this.preferences.find(where, {
        orderBy: { updatedAt: 'desc' },
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      }),
      this.preferences.count(where),
      this.settings.getSettings(userId),
    ]);

    return {
      items: items.map(toPreferenceResponse),
      settings: setting,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  public async create(
    userId: string,
    input: CreatePreferenceInput,
  ): Promise<ReturnType<typeof toPreferenceResponse>> {
    const value = toPreferenceValue(input.category, input.value);
    this.assertSafeValue(value);
    const fingerprint = this.fingerprint(value);
    const em = this.preferences.getEntityManager();

    return em.transactional(async (transactionalEm) => {
      await lockPreferenceUser(transactionalEm, userId);
      const repository = transactionalEm.getRepository(UserPreference);
      const existing = await repository.findOne({
        userId,
        category: input.category,
        valueFingerprint: fingerprint,
        status: UserPreferenceStatus.ACTIVE,
      });
      if (existing) return toPreferenceResponse(existing);

      if (input.isPrimary && SINGLE_VALUE_CATEGORIES.has(input.category)) {
        await repository.nativeUpdate(
          {
            userId,
            category: input.category,
            status: UserPreferenceStatus.ACTIVE,
            isPrimary: true,
          },
          { isPrimary: false },
        );
      }

      const preference = repository.create({
        userId,
        category: input.category,
        value,
        valueType: this.valueType(input.category),
        valueFingerprint: fingerprint,
        isPrimary: input.isPrimary,
        status: UserPreferenceStatus.ACTIVE,
        sourceConversationId: null,
        sourceStatus: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      transactionalEm.persist(preference);
      await repository.getEntityManager().flush();
      return toPreferenceResponse(preference);
    });
  }

  public async update(
    userId: string,
    id: string,
    input: UpdatePreferenceInput,
  ): Promise<ReturnType<typeof toPreferenceResponse>> {
    const em = this.preferences.getEntityManager();
    return em.transactional(async (transactionalEm) => {
      await lockPreferenceUser(transactionalEm, userId);
      const repository = transactionalEm.getRepository(UserPreference);
      const preference = await repository.findOne({
        id,
        userId,
        status: UserPreferenceStatus.ACTIVE,
      });
      if (!preference) throw new NotFoundException('偏好不存在');

      const category = input.category ?? preference.category;
      const value =
        input.value === undefined && input.category === undefined
          ? preference.value
          : toPreferenceValue(
              category,
              input.value === undefined ? preference.value : input.value,
            );
      this.assertSafeValue(value);
      const fingerprint = this.fingerprint(value);

      const duplicate = await repository.findOne({
        userId,
        category,
        valueFingerprint: fingerprint,
        status: UserPreferenceStatus.ACTIVE,
      });
      if (duplicate && duplicate.id !== preference.id) {
        throw new BadRequestException('同类偏好已存在');
      }

      const nextIsPrimary = input.isPrimary ?? preference.isPrimary;
      if (nextIsPrimary && SINGLE_VALUE_CATEGORIES.has(category)) {
        await repository.nativeUpdate(
          {
            userId,
            category,
            status: UserPreferenceStatus.ACTIVE,
            isPrimary: true,
            id: { $ne: preference.id },
          },
          { isPrimary: false },
        );
      }
      preference.category = category;
      preference.value = value;
      preference.valueType = this.valueType(category);
      preference.valueFingerprint = fingerprint;
      preference.isPrimary = nextIsPrimary;
      await repository.getEntityManager().flush();
      return toPreferenceResponse(preference);
    });
  }

  public async delete(userId: string, id: string): Promise<void> {
    await this.preferences.getEntityManager().transactional(async (em) => {
      await lockPreferenceUser(em, userId);
      const preference = await em.findOne(UserPreference, {
        id,
        userId,
        status: UserPreferenceStatus.ACTIVE,
      });
      if (!preference) throw new NotFoundException('偏好不存在');
      preference.status = UserPreferenceStatus.DELETED;
      preference.deletedAt = new Date();
      await em.flush();
    });
  }

  public async deleteAll(userId: string): Promise<{ deletedCount: number }> {
    return this.preferences.getEntityManager().transactional(async (em) => {
      await lockPreferenceUser(em, userId);
      const repository = em.getRepository(UserPreference);
      const preferences = await repository.find({
        userId,
        status: UserPreferenceStatus.ACTIVE,
      });
      const now = new Date();
      for (const preference of preferences) {
        preference.status = UserPreferenceStatus.DELETED;
        preference.deletedAt = now;
      }
      await em.flush();
      return { deletedCount: preferences.length };
    });
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
    if (containsSensitivePreferenceText(value)) {
      throw new BadRequestException('偏好值包含不允许保存的信息');
    }
  }
}
