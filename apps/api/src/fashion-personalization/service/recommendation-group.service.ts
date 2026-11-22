import { Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import { RecommendationGroup } from '../entity/recommendation-group.entity.js';

export type RecommendationTargetType =
  'recommendation' | 'outfit' | 'slot' | 'item';

export type RecommendationTargetInput = {
  targetType: RecommendationTargetType;
  targetRef: string;
  snapshot: Record<string, unknown>;
};

export type PersistRecommendationGroupInput = {
  id?: string;
  userId: string;
  conversationId: string;
  assistantMessageId: string;
  intentSnapshot: Record<string, unknown>;
  targets: RecommendationTargetInput[];
  sourceSnapshot: Array<Record<string, unknown>>;
  expiresAt?: Date | null;
};

export type OwnedRecommendationTarget = {
  group: RecommendationGroup;
  target: RecommendationTargetInput;
};

@Injectable()
export class RecommendationGroupService {
  public constructor(
    @InjectRepository(RecommendationGroup)
    private readonly groups: EntityRepository<RecommendationGroup>,
  ) {}

  public async persistInTransaction(
    entityManager: EntityManager,
    input: PersistRecommendationGroupInput,
  ): Promise<string> {
    const repository = entityManager.getRepository(RecommendationGroup);
    const safeTargets = input.targets
      .filter((target) => this.isSafeTarget(target))
      .map((target) => ({
        targetType: target.targetType,
        targetRef: target.targetRef,
        snapshot: this.safeSnapshot(target.snapshot),
      }));
    if (
      safeTargets.length !== input.targets.length ||
      !safeTargets.some((target) => target.targetType === 'recommendation')
    ) {
      throw new Error('推荐组目标未通过服务端安全校验');
    }

    const group = repository.create({
      ...(input.id ? { id: input.id } : {}),
      userId: input.userId,
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      intentSnapshot: this.safeSnapshot(input.intentSnapshot),
      targets: safeTargets,
      sourceSnapshot: input.sourceSnapshot.map((source) =>
        this.safeSnapshot(source),
      ),
      expiresAt: input.expiresAt ?? null,
      createdAt: new Date(),
    });
    entityManager.persist(group);
    await entityManager.flush();
    return group.id;
  }

  public async lookupOwnedTarget(
    userId: string,
    input: {
      recommendationId: string;
      conversationId: string;
      assistantMessageId: string;
      targetType: RecommendationTargetType;
      targetRef: string;
    },
    entityManager?: EntityManager,
  ): Promise<OwnedRecommendationTarget> {
    const group = await (
      entityManager ?? this.groups.getEntityManager()
    ).findOne(RecommendationGroup, {
      id: input.recommendationId,
      userId,
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
    });
    if (
      !group ||
      (group.expiresAt && group.expiresAt.getTime() <= Date.now())
    ) {
      throw new NotFoundException('推荐目标不存在');
    }
    const rawTarget = group.targets.find(
      (target) =>
        target.targetType === input.targetType &&
        target.targetRef === input.targetRef,
    );
    if (!rawTarget) throw new NotFoundException('推荐目标不存在');
    const target = rawTarget as {
      targetType: RecommendationTargetType;
      targetRef: string;
      snapshot: Record<string, unknown>;
    };
    return {
      group,
      target: {
        targetType: target.targetType,
        targetRef: target.targetRef,
        snapshot: this.safeSnapshot(target.snapshot),
      },
    };
  }

  private isSafeTarget(target: RecommendationTargetInput): boolean {
    return (
      ['recommendation', 'outfit', 'slot', 'item'].includes(
        target.targetType,
      ) &&
      /^[a-zA-Z0-9:_-]{1,160}$/u.test(target.targetRef) &&
      target.snapshot !== null &&
      typeof target.snapshot === 'object' &&
      !Array.isArray(target.snapshot)
    );
  }

  private safeSnapshot(
    value: Record<string, unknown>,
  ): Record<string, unknown> {
    // 推荐快照只保留有限 JSON 字段；不把供应商原始响应写入数据库。
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,48}$/u.test(key)) continue;
      const safe = this.safeJsonValue(item, 0);
      if (safe !== undefined) result[key] = safe;
    }
    return result;
  }

  private safeJsonValue(value: unknown, depth: number): unknown {
    if (depth > 3) return undefined;
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string')
      return value.length <= 512 ? value : value.slice(0, 512);
    if (typeof value === 'number')
      return Number.isFinite(value) ? value : undefined;
    if (Array.isArray(value)) {
      const items = value
        .slice(0, 40)
        .map((item) => this.safeJsonValue(item, depth + 1));
      if (items.some((item) => item === undefined)) return undefined;
      return items;
    }
    if (typeof value === 'object') {
      const nested: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value).slice(0, 40)) {
        if (!/^[a-zA-Z][a-zA-Z0-9_]{0,48}$/u.test(key)) continue;
        const safe = this.safeJsonValue(item, depth + 1);
        if (safe !== undefined) nested[key] = safe;
      }
      return nested;
    }
    return undefined;
  }
}
