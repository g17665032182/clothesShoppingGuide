import { z } from 'zod';

import { OrderStatus } from '../../orders/index.js';

export const informationSectionSchema = z.enum([
  'addresses',
  'orders',
  'photos',
]);

export const getMyInformationSchema = z
  .strictObject({
    sections: z
      .array(informationSectionSchema)
      .min(1)
      .max(3)
      .refine((sections) => new Set(sections).size === sections.length)
      .default(['addresses', 'orders', 'photos']),
    orderNo: z.string().trim().min(1).max(100).optional(),
    status: z.enum(OrderStatus).optional(),
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
  );

export type InformationSection = z.output<typeof informationSectionSchema>;
export type GetMyInformationInput = z.output<typeof getMyInformationSchema>;
