import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MikroORM, RequestContext } from '@mikro-orm/core';

import { RecommendationProfileService } from '../service/recommendation-profile.service.js';
import { RecommendationProfileTaskService } from './recommendation-profile-task.service.js';

const POLL_INTERVAL_MS = 1_000;

@Injectable()
export class RecommendationProfileSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    RecommendationProfileSchedulerService.name,
  );
  private timer: NodeJS.Timeout | undefined;
  private work: Promise<void> | undefined;
  private stopped = false;
  private lastCleanupAt = 0;

  public constructor(
    private readonly tasks: RecommendationProfileTaskService,
    private readonly profiles: RecommendationProfileService,
    @Inject(MikroORM) private readonly orm: MikroORM,
  ) {}

  public onModuleInit(): void {
    this.timer = setInterval(() => this.startPoll(), POLL_INTERVAL_MS);
    this.timer.unref();
    this.startPoll();
  }

  public async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.work;
  }

  private startPoll(): void {
    if (this.work || this.stopped) return;
    this.work = RequestContext.create(this.orm.em, () => this.poll()).finally(
      () => {
        this.work = undefined;
      },
    );
  }

  private async poll(): Promise<void> {
    try {
      if (Date.now() - this.lastCleanupAt >= 60_000) {
        await this.tasks.cleanupExpiredData();
        this.lastCleanupAt = Date.now();
      }
      await this.tasks.recoverExpiredProcessing();
      const batch = await this.tasks.claimBatch();
      for (const task of batch) {
        if (this.stopped) return;
        try {
          await this.profiles.process(task);
          await this.tasks.markSucceeded(task);
        } catch (error) {
          const code =
            error instanceof Error
              ? error.name.slice(0, 80)
              : 'PROFILE_UPDATE_FAILED';
          await this.tasks.markFailed(task, code);
          this.logger.warn({
            context: RecommendationProfileSchedulerService.name,
            code,
          });
        }
      }
    } catch {
      this.logger.warn({
        context: RecommendationProfileSchedulerService.name,
        code: 'TASK_POLL_FAILED',
      });
    }
  }
}
