import type { LlmStreamEvent } from './llm-stream.types.js';

export type LlmStreamEnvelope = {
  event: LlmStreamEvent;
  acknowledge: () => void;
};

/** Graph 的取消返回可能先于节点清理完成，显式等待模型迭代器退出。 */
export class LlmStreamLifecycle {
  private readonly active = new Set<Promise<void>>();

  public begin(): () => void {
    let finish!: () => void;
    const completion = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.active.add(completion);
    return () => {
      this.active.delete(completion);
      finish();
    };
  }

  public async waitForIdle(): Promise<void> {
    await Promise.all(this.active);
  }
}

export function isStreamEnvelope(value: unknown): value is LlmStreamEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    'event' in value &&
    'acknowledge' in value &&
    typeof value.acknowledge === 'function'
  );
}

/** 消费者继续拉取后才释放生产者，避免慢客户端导致模型增量无界积压。 */
export async function writeStreamEvent(
  writer: (value: unknown) => void,
  event: LlmStreamEvent,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(signal?.reason ?? new DOMException('请求已取消', 'AbortError'));
    };
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const acknowledge = () => {
      cleanup();
      resolve();
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      writer({ event, acknowledge } satisfies LlmStreamEnvelope);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
