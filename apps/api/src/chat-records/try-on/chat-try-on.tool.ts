import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import type {
  ChatTryOnOutcome,
  ChatTryOnPort,
  ChatTryOnStatus as ChatTryOnProgress,
} from '../../virtual-try-on/port/chat-try-on.port.js';

const tryOnToolSchema = z.strictObject({
  productExternalId: z.string().trim().min(1).max(160),
  photoId: z.uuid(),
});

export type ChatTryOnToolContext = {
  userId: string;
  color: string;
  consentVersion: string;
  signal?: AbortSignal;
  onStatus?: (status: ChatTryOnProgress) => void;
};

export function createChatTryOnTool(
  port: ChatTryOnPort,
  context: ChatTryOnToolContext,
) {
  return tool(
    async (input): Promise<[string, ChatTryOnOutcome]> => {
      const outcome = await port.run({
        userId: context.userId,
        productExternalId: input.productExternalId,
        color: context.color,
        photoId: input.photoId,
        consentVersion: context.consentVersion,
        ...(context.signal ? { signal: context.signal } : {}),
        ...(context.onStatus ? { onStatus: context.onStatus } : {}),
      });
      const safeContent =
        outcome.status === 'succeeded'
          ? { status: outcome.status, taskId: outcome.result.taskId }
          : {
              status: outcome.status,
              ...(outcome.taskId ? { taskId: outcome.taskId } : {}),
              code: outcome.code,
            };
      return [JSON.stringify(safeContent), outcome];
    },
    {
      name: 'try_on_product',
      description: '为用户选定的服装商品执行一次虚拟试穿。',
      schema: tryOnToolSchema,
      responseFormat: 'content_and_artifact',
    },
  );
}
