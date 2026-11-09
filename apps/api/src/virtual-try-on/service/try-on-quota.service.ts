import { ConflictException, Injectable } from '@nestjs/common';
import { LockMode, type EntityManager } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import { TryOnQuota } from '../entity/try-on-quota.entity.js';

const LIMIT = 5;

@Injectable()
export class TryOnQuotaService {
  public constructor(
    @InjectRepository(TryOnQuota)
    private readonly quotas: EntityRepository<TryOnQuota>,
  ) {}

  public quotaDate(now = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }

  public async assertAvailable(
    em: EntityManager,
    userId: string,
    now = new Date(),
  ): Promise<void> {
    const date = this.quotaDate(now);
    const quota = await em.findOne(
      TryOnQuota,
      { userId, quotaDate: date },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (quota && quota.successCount >= LIMIT) {
      throw new ConflictException({
        code: 'DAILY_QUOTA_EXCEEDED',
        message: '今日试穿次数已用完',
      });
    }
  }

  public async incrementInTransaction(
    em: EntityManager,
    userId: string,
    now = new Date(),
  ): Promise<void> {
    const date = this.quotaDate(now);
    let quota = await em.findOne(
      TryOnQuota,
      { userId, quotaDate: date },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (!quota) {
      quota = em.create(TryOnQuota, {
        userId,
        quotaDate: date,
        successCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    if (quota.successCount >= LIMIT) {
      throw new ConflictException({
        code: 'DAILY_QUOTA_EXCEEDED',
        message: '今日试穿次数已用完',
      });
    }
    quota.successCount += 1;
    quota.updatedAt = new Date();
    await em.flush();
  }

  public async getUsage(userId: string, now = new Date()) {
    const quota = await this.quotas.findOne({
      userId,
      quotaDate: this.quotaDate(now),
    });
    return {
      used: quota?.successCount ?? 0,
      limit: LIMIT,
      remaining: Math.max(0, LIMIT - (quota?.successCount ?? 0)),
    };
  }
}
