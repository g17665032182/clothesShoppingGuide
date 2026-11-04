import { Injectable, Logger, Inject } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MikroORM, RequestContext } from '@mikro-orm/core';

import { MEMORY_TASK_POLL_INTERVAL_MS } from '../task/memory-task-claim.js';
import { UserMemoryExtractorService } from './user-memory-extractor.service.js';
import { UserMemoryTaskService } from './user-memory-task.service.js';

const FAILURE_CODES = new Set([
  'MODEL_TIMEOUT',
  'MODEL_UNAVAILABLE',
  'INVALID_OUTPUT',
  'STORAGE_UNAVAILABLE',
  'DATABASE_RETRYABLE',
  'EXTRACTION_FAILED',
  'TASK_POLL_FAILED',
]);

@Injectable()
export class UserMemorySchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(UserMemorySchedulerService.name);
  private timer: NodeJS.Timeout | undefined;
  private work: Promise<void> | undefined;
  private stopped = false;
  private nextFailureLogAt = 0;

  public constructor(
    private readonly tasks: UserMemoryTaskService,
    private readonly extractor: UserMemoryExtractorService,
    @Inject(MikroORM) private readonly orm: MikroORM,
  ) {}

  public onModuleInit(): void {
    this.timer = setInterval(
      () => this.startPoll(),
      MEMORY_TASK_POLL_INTERVAL_MS,
    );
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
    // 后台轮询也需要独立工作单元，不能复用根 EM 的 identity map。
    this.work = RequestContext.create(this.orm.em, () => this.poll()).finally(
      () => {
        this.work = undefined;
      },
    );
  }

  private async poll(): Promise<void> {
    try {
      await this.tasks.recoverExpiredProcessing();
      const tasks = await this.tasks.claimBatch();
      let processed = false;
      let failed = false;
      for (const task of tasks) {
        if (this.stopped) return;
        try {
          await this.extractor.process(task);
          await this.tasks.markSucceeded(task);
          processed = true;
        } catch (error) {
          failed = true;
          const code = this.extractor.getFailureCode(error);
          await this.tasks.markFailed(task, code);
          this.logFailure(code, task.id);
        }
      }
      // 空轮询不代表上一次模型或存储故障已经恢复。
      if (processed && !failed) this.nextFailureLogAt = 0;
    } catch {
      this.logFailure('TASK_POLL_FAILED');
    }
  }

  private logFailure(code: string, taskId?: string): void {
    if (Date.now() < this.nextFailureLogAt) return;
    this.nextFailureLogAt = Date.now() + 30_000;
    const safeCode = FAILURE_CODES.has(code) ? code : 'EXTRACTION_FAILED';
    const safeTaskId =
      taskId && /^[0-9a-f-]{36}$/iu.test(taskId) ? taskId : undefined;
    this.logger.warn({
      context: UserMemorySchedulerService.name,
      code: safeCode,
      ...(safeTaskId ? { taskId: safeTaskId } : {}),
    });
  }
}
