import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TryOnTaskStatus } from '../entity/try-on-task.entity.js';
import type {
  ChatTryOnOutcome,
  ChatTryOnPort,
  ChatTryOnStatus,
} from '../port/chat-try-on.port.js';
import type { CreateTryOnTaskInput } from '../dto/try-on-task.dto.js';
import { TryOnTaskService } from './try-on-task.service.js';

const POLL_INTERVAL_MS = 2_000;
const SAFE_FAILURE_CODES = new Set([
  'ACTIVE_TASK_EXISTS',
  'DAILY_QUOTA_EXCEEDED',
  'CONSENT_REQUIRED',
  'PRODUCT_NOT_TRYON_SUPPORTED',
  'COLOR_UNAVAILABLE',
  'PHOTO_UNAVAILABLE',
  'PHOTO_UNAVAILABLE',
  'TRY_ON_DISABLED',
  'PROVIDER_REJECTED',
  'INVALID_PROVIDER_OUTPUT',
  'PROVIDER_TIMEOUT',
  'TRANSIENT_PROVIDER_ERROR',
  'IMAGE_UNAVAILABLE',
  'STORAGE_UNAVAILABLE',
  'PROCESSING_TIMEOUT',
]);

@Injectable()
export class ChatTryOnService implements ChatTryOnPort {
  public constructor(
    private readonly tasks: TryOnTaskService,
    private readonly config: ConfigService,
  ) {}

  public async run(input: {
    userId: string;
    productExternalId: string;
    color: string;
    photoId: string;
    consentVersion: string;
    signal?: AbortSignal;
    onStatus?: (status: ChatTryOnStatus) => void;
  }): Promise<ChatTryOnOutcome> {
    let taskId: string | undefined;
    try {
      const task = await this.tasks.create(input.userId, {
        productExternalId: input.productExternalId,
        color: input.color,
        photoId: input.photoId,
        consentVersion: input.consentVersion,
      } satisfies CreateTryOnTaskInput);
      taskId = task.id;
      let lastStatus: ChatTryOnStatus['status'] | undefined;
      const startedAt = Date.now();
      const processingTimeout = this.readPositiveInteger(
        'TRY_ON_PROCESSING_TIMEOUT_MS',
        180_000,
      );
      const deadline =
        startedAt +
        processingTimeout * 2 +
        Math.max(POLL_INTERVAL_MS * 5, 30_000);

      while (Date.now() < deadline) {
        input.signal?.throwIfAborted();
        const current = await this.tasks.get(input.userId, task.id);
        if (
          current.status === TryOnTaskStatus.QUEUED ||
          current.status === TryOnTaskStatus.PROCESSING
        ) {
          if (lastStatus !== current.status) {
            lastStatus = current.status;
            input.onStatus?.({
              taskId: task.id,
              status: current.status,
            });
          }
          await this.delay(POLL_INTERVAL_MS, input.signal);
          continue;
        }
        if (current.status === TryOnTaskStatus.SUCCEEDED) {
          return {
            status: 'succeeded',
            result: await this.tasks.readChatResult(input.userId, task.id),
          };
        }
        return {
          status: 'failed',
          taskId: task.id,
          code: this.safeCode(current.failureCode),
        };
      }

      return {
        status: 'timed_out',
        taskId: task.id,
        code: 'TRY_ON_WAIT_TIMEOUT',
      };
    } catch (error) {
      if (input.signal?.aborted) throw error;
      return {
        status: 'failed',
        ...(taskId ? { taskId } : {}),
        code: this.safeErrorCode(error),
      };
    }
  }

  public async canReadResult(userId: string, taskId: string): Promise<boolean> {
    try {
      const task = await this.tasks.get(userId, taskId);
      return task.status === TryOnTaskStatus.SUCCEEDED && task.result !== null;
    } catch (error) {
      if (error instanceof NotFoundException) return false;
      return false;
    }
  }

  private safeErrorCode(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (
        typeof response === 'object' &&
        response !== null &&
        'code' in response &&
        typeof response.code === 'string'
      ) {
        return this.safeCode(response.code);
      }
    }
    return 'TRY_ON_UNAVAILABLE';
  }

  private safeCode(value: string | null | undefined): string {
    return value && SAFE_FAILURE_CODES.has(value)
      ? value
      : 'TRY_ON_UNAVAILABLE';
  }

  private readPositiveInteger(name: string, fallback: number): number {
    const value = Number(this.config.get<string | number>(name) ?? fallback);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  }

  private async delay(duration: number, signal?: AbortSignal): Promise<void> {
    if (!signal) {
      await new Promise((resolve) => setTimeout(resolve, duration));
      return;
    }
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, duration);
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('请求已取消', 'AbortError'));
      };
      signal.addEventListener('abort', abort, { once: true });
    });
  }
}
