import { z } from 'zod';

import { containsSensitiveMemoryText } from './memory-safety.js';

const patchTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((text) => !text.includes('\u0000'), '候选内容包含非法字符')
  .refine((text) => !containsSensitiveMemoryText(text), {
    message: '候选内容包含不允许保存的信息',
  });

const operationBase = {
  explicit: z.literal(true),
};

export const memoryDocumentOperationSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    ...operationBase,
    operation: z.literal('append'),
    section: z.enum(['clothing', 'other']),
    markdown: patchTextSchema,
  }),
  z.strictObject({
    ...operationBase,
    operation: z.literal('replace'),
    targetText: patchTextSchema,
    replacement: patchTextSchema,
  }),
  z.strictObject({
    ...operationBase,
    operation: z.literal('delete'),
    targetText: patchTextSchema,
  }),
]);

export const memoryDocumentOperationsSchema = z
  .array(memoryDocumentOperationSchema)
  .max(10);

export type MemoryDocumentOperation = z.infer<
  typeof memoryDocumentOperationSchema
>;
