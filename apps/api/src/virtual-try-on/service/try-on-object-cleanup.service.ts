import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { MikroORM, RequestContext, type EntityManager } from '@mikro-orm/core';
import { EntityRepository } from '@mikro-orm/postgresql';

import { TryOnObjectCleanup } from '../entity/try-on-object-cleanup.entity.js';
import {
  TRY_ON_OBJECT_STORE,
  type TryOnObjectStore,
} from '../port/try-on-object-store.port.js';

const RETRY_DELAY_MS = 60 * 60 * 1000;
const BATCH_SIZE = 20;

@Injectable()
export class TryOnObjectCleanupService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TryOnObjectCleanupService.name);
  private timer: NodeJS.Timeout | undefined;
  private work: Promise<void> | undefined;
  private stopped = false;
  private nextFailureLogAt = 0;

  public constructor(
    @InjectRepository(TryOnObjectCleanup)
    private readonly cleanups: EntityRepository<TryOnObjectCleanup>,
    @Inject(TRY_ON_OBJECT_STORE)
    private readonly store: TryOnObjectStore,
    @Inject(MikroORM) private readonly orm: MikroORM,
  ) {}

  public onModuleInit(): void {
    this.timer = setInterval(() => this.startPoll(), RETRY_DELAY_MS);
    this.timer.unref();
    this.startPoll();
  }

  public async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.work;
  }

  public async schedule(
    em: EntityManager,
    userId: string | null,
    objectKey: string,
  ): Promise<void> {
    const repository = em.getRepository(TryOnObjectCleanup);
    const existing = await repository.findOne({ objectKey });
    if (existing) {
      existing.userId = userId;
      existing.attempts = 0;
      existing.lastErrorCode = null;
      existing.nextAttemptAt = new Date();
    } else {
      repository.create({
        userId,
        objectKey,
        attempts: 0,
        nextAttemptAt: new Date(),
        createdAt: new Date(),
      });
    }
    await em.flush();
  }

  public async cancel(em: EntityManager, objectKey: string): Promise<void> {
    await em.nativeDelete(TryOnObjectCleanup, { objectKey });
  }

  public async processDueBatch(): Promise<void> {
    const em = this.cleanups.getEntityManager().fork();
    const due = await em.find(
      TryOnObjectCleanup,
      { nextAttemptAt: { $lte: new Date() } },
      { orderBy: { nextAttemptAt: 'asc' }, limit: BATCH_SIZE },
    );
    for (const cleanup of due) {
      if (this.stopped) return;
      try {
        await this.store.deleteObject(cleanup.objectKey);
        await em.nativeDelete(TryOnObjectCleanup, { id: cleanup.id });
      } catch {
        cleanup.attempts += 1;
        cleanup.lastErrorCode = 'OBJECT_DELETE_FAILED';
        cleanup.nextAttemptAt = new Date(Date.now() + RETRY_DELAY_MS);
        await em.flush();
        this.logFailure();
      }
    }
  }

  private startPoll(): void {
    if (this.stopped || this.work) return;
    this.work = RequestContext.create(this.orm.em, () => this.poll()).finally(
      () => {
        this.work = undefined;
      },
    );
  }

  private async poll(): Promise<void> {
    try {
      await this.processDueBatch();
      this.nextFailureLogAt = 0;
    } catch {
      this.logFailure();
    }
  }

  private logFailure(): void {
    if (Date.now() < this.nextFailureLogAt) return;
    this.nextFailureLogAt = Date.now() + 30_000;
    this.logger.warn({
      context: TryOnObjectCleanupService.name,
      code: 'OBJECT_CLEANUP_FAILED',
    });
  }
}
