import { z } from 'zod';

import { OrderStatus } from '../entity/order.entity.js';

const orderNoSchema = z
  .string()
  .regex(/^[^\u0000-\u001f\u007f]*$/u)
  .trim()
  .min(1)
  .max(100);

export const orderFulfillmentLookupSchema = z.strictObject({
  orderNo: orderNoSchema,
});

export const orderFulfillmentLookupResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    source: z.literal('local_order_record'),
    realtimeTrackingAvailable: z.literal(false),
    order: z.strictObject({
      orderNo: orderNoSchema,
      status: z.enum(OrderStatus),
      shippedAt: z.iso.datetime().nullable(),
      completedAt: z.iso.datetime().nullable(),
    }),
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum(['not_found', 'unavailable']),
  }),
]);

export type OrderFulfillmentLookupSchemaInput = z.input<
  typeof orderFulfillmentLookupSchema
>;
export type OrderFulfillmentLookupInput = z.output<
  typeof orderFulfillmentLookupSchema
>;
export type OrderFulfillmentLookupResult = z.output<
  typeof orderFulfillmentLookupResultSchema
>;
