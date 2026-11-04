import { z } from 'zod';

import { memoryDocumentOperationsSchema } from './memory-document-patch.schema.js';

export const memoryCandidateSchema = z.strictObject({
  operations: memoryDocumentOperationsSchema,
});

export type MemoryCandidate = z.infer<typeof memoryCandidateSchema>;
