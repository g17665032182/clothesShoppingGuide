import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { MEMORY_TASK_POLL_INTERVAL_MS } from '../task/memory-task-claim.js';
import { UserMemoryExtractorService } from './user-memory-extractor.service.js';
import { UserMemoryTaskService } from './user-memory-task.service.js';

const FAILURE_LOG_INTERVAL_MS = 30_000;

type SchedulerError = Error & {
  code?: unknown;
  sqlState?: unknown;
};

@Injectable()
export class UserMemorySchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(UserMemorySchedulerService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;
  private nextFailureLogAt = 0;

  public constructor(
    private readonly tasks: UserMemoryTaskService,
    private readonly extractor: UserMemoryExtractorService,
  ) {}

  public async onModuleInit(): Promise<void> {
    try {
      await this.tasks.recoverExpiredProcessing();
    } catch (error) {
      this.logFailure('用户记忆任务超时恢复失败', error);
    }
    this.timer = setInterval(() => {
      void this.poll();
    }, MEMORY_TASK_POLL_INTERVAL_MS);
    this.timer.unref();
    void this.poll();
  }

  public onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const tasks = await this.tasks.claimBatch();
      for (const task of tasks) {
        if (this.stopped) return;
        try {
          await this.extractor.process(task);
          await this.tasks.markSucceeded(task.id);
        } catch (error) {
          await this.tasks.markFailed(
            task,
            this.extractor.getFailureCode(error),
          );
        }
      }
    } catch (error) {
      this.logFailure('用户记忆任务轮询失败', error);
    } finally {
      this.running = false;
    }
  }

  private logFailure(message: string, error: unknown): void {
    const now = Date.now();
    if (now < this.nextFailureLogAt) return;

    // 数据库不可用时任务会持续轮询，节流日志但保留首条错误码供定位。
    this.nextFailureLogAt = now + FAILURE_LOG_INTERVAL_MS;
    if (error instanceof Error) {
      const detail = error as SchedulerError;
      const code =
        typeof detail.code === 'string'
          ? detail.code
          : typeof detail.sqlState === 'string'
            ? detail.sqlState
            : undefined;
      this.logger.error(
        `${message}${code ? ` (${code})` : ''}: ${error.message}`,
      );
      return;
    }

    this.logger.error(`${message}: ${String(error)}`);
  }
}
