import { z } from 'zod';

import { ReturnRefundStatus } from '../entity/return-refund-application.entity.js';

const statusValues = Object.values(ReturnRefundStatus) as [
  ReturnRefundStatus,
  ...ReturnRefundStatus[],
];
const noControlCharacters = (value: string) =>
  !/[\u0000-\u001f\u007f]/u.test(value);

export const returnRefundOrderIdSchema = z.strictObject({
  orderId: z.uuid(),
});

export const returnRefundApplicationIdSchema = z.strictObject({
  id: z.uuid(),
});

const returnRefundItemsSchema = z
  .array(
    z.strictObject({
      orderItemId: z.uuid(),
      quantity: z.number().int().safe().min(1).max(99),
    }),
  )
  .min(1)
  .max(50)
  .refine(
    (items) =>
      new Set(items.map((item) => item.orderItemId)).size === items.length,
    '申请商品不能重复',
  );

const reasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine(noControlCharacters);

export const createAndSubmitReturnRefundSchema = z.strictObject({
  items: returnRefundItemsSchema,
  reason: reasonSchema,
  idempotencyKey: z.uuid(),
});

export const createReturnRefundDraftSchema = z.strictObject({
  orderId: z.uuid(),
  items: returnRefundItemsSchema,
  reason: reasonSchema,
});

export const submitReturnRefundSchema = z.strictObject({
  version: z.number().int().safe().min(1),
});

export const returnRefundVersionSchema = z.strictObject({
  version: z.number().int().safe().min(1),
});

export const emptyReturnRefundActionSchema = z.strictObject({});

export const returnRefundShipmentSchema = z.strictObject({
  carrier: z.string().trim().min(1).max(100).refine(noControlCharacters),
  trackingNo: z.string().trim().min(1).max(100).refine(noControlCharacters),
  version: z.number().int().safe().min(1),
});

export const rejectReturnRefundSchema = z.strictObject({
  reason: reasonSchema,
  version: z.number().int().safe().min(1),
});

const pageSchema = z.coerce.number().int().safe().min(1).default(1);
const pageSizeSchema = z.coerce
  .number()
  .int()
  .safe()
  .min(1)
  .max(100)
  .default(20);

export const returnRefundUserQuerySchema = z.strictObject({
  page: pageSchema,
  pageSize: pageSizeSchema,
  status: z.enum(statusValues).optional(),
});

export const adminReturnRefundQuerySchema = z.strictObject({
  page: pageSchema,
  pageSize: pageSizeSchema,
  status: z.enum(statusValues).optional(),
  manualReviewRequired: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  orderNo: z.string().trim().min(1).max(100).optional(),
});

export type ReturnRefundOrderIdInput = z.output<
  typeof returnRefundOrderIdSchema
>;
export type ReturnRefundApplicationIdInput = z.output<
  typeof returnRefundApplicationIdSchema
>;
export type CreateAndSubmitReturnRefundInput = z.output<
  typeof createAndSubmitReturnRefundSchema
>;
export type CreateReturnRefundDraftInput = z.output<
  typeof createReturnRefundDraftSchema
>;
export type SubmitReturnRefundInput = z.output<typeof submitReturnRefundSchema>;
export type ReturnRefundVersionInput = z.output<
  typeof returnRefundVersionSchema
>;
export type ReturnRefundShipmentInput = z.output<
  typeof returnRefundShipmentSchema
>;
export type RejectReturnRefundInput = z.output<typeof rejectReturnRefundSchema>;
export type ReturnRefundUserQuery = z.output<
  typeof returnRefundUserQuerySchema
>;
export type AdminReturnRefundQuery = z.output<
  typeof adminReturnRefundQuerySchema
>;
