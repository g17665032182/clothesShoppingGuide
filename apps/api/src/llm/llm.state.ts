import { MessagesValue, StateSchema } from '@langchain/langgraph';
import { z } from 'zod';

export const LlmUsageSchema = z.object({
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  totalTokens: z.number().nullable(),
});

export type LlmUsage = z.infer<typeof LlmUsageSchema>;

export const LlmState = new StateSchema({
  messages: MessagesValue,
  usage: LlmUsageSchema.optional(),
});

export type LlmStateValue = typeof LlmState.State;
export type LlmStateUpdate = typeof LlmState.Update;
