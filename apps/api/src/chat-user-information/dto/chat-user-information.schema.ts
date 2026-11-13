import { z } from 'zod';

import { OrderStatus } from '../../orders/index.js';
import { tryOnTaskMetadataStatusSchema } from '../../virtual-try-on/index.js';

export const informationSectionSchema = z.enum([
  'addresses',
  'orders',
  'photos',
  'try_on_tasks',
]);

export const getMyInformationSchema = z
  .strictObject({
    sections: z
      .array(informationSectionSchema)
      .min(1)
      .max(4)
      .refine((sections) => new Set(sections).size === sections.length)
      .default(['addresses', 'orders', 'photos']),
    orderNo: z.string().trim().min(1).max(100).optional(),
    status: z.enum(OrderStatus).optional(),
    tryOnStatus: tryOnTaskMetadataStatusSchema.optional(),
    page: z.number().int().safe().min(1).max(10).default(1),
  })
  .refine(
    (input) =>
      input.sections.includes('orders') ||
      (input.orderNo === undefined && input.status === undefined),
    {
      path: ['sections'],
      error: '订单筛选条件只能用于 orders section',
    },
  )
  .refine(
    (input) =>
      input.sections.includes('try_on_tasks') ||
      input.tryOnStatus === undefined,
    {
      path: ['sections'],
      error: '试穿状态筛选只能用于 try_on_tasks section',
    },
  );

export type InformationSection = z.output<typeof informationSectionSchema>;
export type GetMyInformationSchemaInput = z.input<
  typeof getMyInformationSchema
>;
export type GetMyInformationInput = z.output<typeof getMyInformationSchema>;
