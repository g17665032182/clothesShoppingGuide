import { z } from 'zod';

export const tryOnTaskMetadataStatusSchema = z.enum([
  'queued',
  'processing',
  'succeeded',
  'failed',
]);

const page = z.number().int().safe().min(1).max(10);
const snapshotText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[^\u0000-\u001f\u007f]*$/u)
    .refine((value) => value.trim().length > 0);

export const tryOnTaskMetadataQuerySchema = z.strictObject({
  page,
  status: tryOnTaskMetadataStatusSchema.optional(),
});

export const tryOnTaskMetadataItemSchema = z.strictObject({
  taskId: z.uuid(),
  status: tryOnTaskMetadataStatusSchema,
  product: z.strictObject({
    externalId: snapshotText(160),
    name: snapshotText(200),
    category: z.enum(['tops', 'bottoms', 'dresses', 'outerwear']),
    color: snapshotText(32),
  }),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  resultAvailable: z.boolean(),
});

export const tryOnTaskMetadataPageSchema = z.strictObject({
  items: z.array(tryOnTaskMetadataItemSchema).max(5),
  page,
  pageSize: z.literal(5),
  total: z.number().int().safe().min(0),
});

export type TryOnTaskMetadataQuery = z.output<
  typeof tryOnTaskMetadataQuerySchema
>;
export type TryOnTaskMetadataItem = z.output<
  typeof tryOnTaskMetadataItemSchema
>;
export type TryOnTaskMetadataPage = z.output<
  typeof tryOnTaskMetadataPageSchema
>;
