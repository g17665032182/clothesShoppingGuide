import { z } from 'zod';

import { memoryDocumentContentSchema } from './memory-document.schema.js';

const patchTextSchema = memoryDocumentContentSchema.trim().min(1).max(2000);

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
