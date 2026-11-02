import { z } from 'zod';

import {
  memoryCategorySchema,
  parseMemoryValue,
} from './memory-value.schema.js';

const candidateOperationSchema = z
  .strictObject({
    operation: z.enum(['upsert', 'delete']),
    category: memoryCategorySchema,
    value: z.unknown(),
    isPrimary: z.boolean().optional(),
    explicit: z.boolean(),
  })
  .superRefine((candidate, context) => {
    try {
      parseMemoryValue(candidate.category, candidate.value);
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: '候选值与类别不匹配',
      });
    }
  });

export const memoryCandidateSchema = z.strictObject({
  operations: z.array(candidateOperationSchema).max(10),
});

export type MemoryCandidate = z.infer<typeof memoryCandidateSchema>;
