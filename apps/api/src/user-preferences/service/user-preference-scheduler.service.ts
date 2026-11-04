import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MikroORM, RequestContext } from '@mikro-orm/core';

import { PREFERENCE_TASK_POLL_INTERVAL_MS } from '../task/preference-task-claim.js';
import { UserPreferenceExtractorService } from './user-preference-extractor.service.js';
import { UserPreferenceTaskService } from './user-preference-task.service.js';

const FAILURE_LOG_INTERVAL_MS = 30_000;

@Injectable()
export class UserPreferenceSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(UserPreferenceSchedulerService.name);
  private timer: NodeJS.Timeout | undefined;
  private active: Promise<void> | undefined;
  private stopped = false;
  private nextFailureLogAt = 0;
  private lastFailureCode: string | undefined;

  public constructor(
    private readonly orm: MikroORM,
    private readonly tasks: UserPreferenceTaskService,
    private readonly extractor: UserPreferenceExtractorService,
  ) {}

  public async onModuleInit(): Promise<void> {
    if (this.stopped) return;
    this.timer = setInterval(
      () => void this.poll(),
      PREFERENCE_TASK_POLL_INTERVAL_MS,
    );
    this.timer.unref();
    void this.poll();
  }

  public async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    // 模型端口及数据库都有超时；停止领取后只等待当前任务退出。
    await this.active;
  }

  public async poll(): Promise<void> {
    if (this.active || this.stopped) return;
    const work = RequestContext.create(this.orm.em, async () => {
      try {
        await this.tasks.recoverExpiredProcessing();
        const tasks = await this.tasks.claimBatch();
        let failed = false;
        let completed = false;
        for (const task of tasks) {
          if (this.stopped) return;
          try {
            await this.extractor.process(task);
            await this.tasks.markSucceeded(task);
            completed = true;
          } catch (error) {
            const code = this.extractor.getFailureCode(error);
            await this.tasks.markFailed(task, code);
            this.logFailure(code);
            failed = true;
          }
        }
        if (
          !failed &&
          (completed || this.lastFailureCode === 'DATABASE_RETRYABLE')
        ) {
          this.nextFailureLogAt = 0;
          this.lastFailureCode = undefined;
        }
      } catch {
        this.logFailure('DATABASE_RETRYABLE');
      }
    });
    this.active = work;
    try {
      await work;
    } finally {
      this.active = undefined;
    }
  }

  private logFailure(code: string): void {
    const now = Date.now();
    if (now < this.nextFailureLogAt) return;
    this.nextFailureLogAt = now + FAILURE_LOG_INTERVAL_MS;
    this.lastFailureCode = code;
    this.logger.error(`用户偏好任务处理失败 (${code})`);
  }
}
