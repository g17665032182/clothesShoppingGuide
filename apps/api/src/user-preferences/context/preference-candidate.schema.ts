import { z } from 'zod';

import {
  preferenceCategorySchema,
  parsePreferenceValue,
} from './preference-value.schema.js';

const candidateOperationSchema = z
  .strictObject({
    operation: z.enum(['upsert', 'delete']),
    category: preferenceCategorySchema,
    value: z.unknown(),
    isPrimary: z.boolean().optional(),
    explicit: z.boolean(),
  })
  .superRefine((candidate, context) => {
    try {
      parsePreferenceValue(candidate.category, candidate.value);
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: '候选值与类别不匹配',
      });
    }
  })
  .transform((candidate) => ({
    ...candidate,
    value: parsePreferenceValue(candidate.category, candidate.value),
  }));

export const preferenceCandidateSchema = z.strictObject({
  operations: z.array(candidateOperationSchema).max(10),
});

export type PreferenceCandidate = z.output<typeof preferenceCandidateSchema>;
export type PreferenceOperation = PreferenceCandidate['operations'][number];
