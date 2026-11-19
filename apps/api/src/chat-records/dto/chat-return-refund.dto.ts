import { z } from 'zod';

const uuidSchema = z.uuid();
const orderStatusSchema = z.enum([
  'pending_payment',
  'pending_shipment',
  'pending_receipt',
  'completed',
  'closed',
]);
const timestampSchema = z.iso.datetime({ offset: true }).nullable();
const textSchema = z.string().min(1).max(200);
const amountSchema = z.string().regex(/^\d+\.\d{2}$/u);

export const listMyReturnRefundOrdersInputSchema = z.strictObject({});

export const getMyReturnRefundItemsInputSchema = z.strictObject({
  orderId: uuidSchema,
});

export const createReturnRefundApplicationInputSchema = z.strictObject({
  orderId: uuidSchema,
  items: z
    .array(
      z.strictObject({
        orderItemId: uuidSchema,
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(50),
  reason: z.string().trim().min(1).max(1000),
});

const orderCandidateSchema = z.strictObject({
  id: uuidSchema,
  orderNo: z.string().trim().min(1).max(100),
  status: orderStatusSchema,
  completedAt: timestampSchema,
  currency: z.literal('CNY'),
  itemCount: z.number().int().nonnegative(),
});

const orderOptionsItemSchema = z.strictObject({
  orderItemId: uuidSchema,
  productName: textSchema,
  productExternalId: z.string().trim().min(1).max(160),
  color: z.string().max(32),
  size: z.string().max(32),
  imageUrl: z.string().url().max(2048).nullable(),
  unitPrice: amountSchema,
  quantity: z.number().int().min(1).max(99),
  availableQuantity: z.number().int().min(0).max(99),
});

const returnRefundApplicationItemSchema = z.strictObject({
  productName: textSchema,
  color: z.string().max(32),
  size: z.string().max(32),
  quantity: z.number().int().min(1).max(99),
});

const unavailableSchema = z.strictObject({
  ok: z.literal(false),
  code: z.enum(['not_found', 'unavailable']),
});

export const listMyReturnRefundOrdersResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    items: z.array(orderCandidateSchema).max(5),
  }),
  unavailableSchema,
]);

export const getMyReturnRefundItemsResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    order: z.strictObject({
      orderId: uuidSchema,
      orderNo: z.string().trim().min(1).max(100),
      status: orderStatusSchema,
      completedAt: timestampSchema,
      currency: z.literal('CNY'),
      items: z.array(orderOptionsItemSchema).max(50),
    }),
  }),
  unavailableSchema,
]);

export const createReturnRefundApplicationResultSchema = z.discriminatedUnion(
  'ok',
  [
    z.strictObject({
      ok: z.literal(true),
      applicationId: uuidSchema,
      orderNo: z.string().trim().min(1).max(100),
      status: z.literal('pending_user_submission'),
      currency: z.literal('CNY'),
      refundAmount: amountSchema,
      items: z.array(returnRefundApplicationItemSchema).min(1).max(50),
    }),
    unavailableSchema,
  ],
);

export type ListMyReturnRefundOrdersInput = z.output<
  typeof listMyReturnRefundOrdersInputSchema
>;
export type GetMyReturnRefundItemsInput = z.output<
  typeof getMyReturnRefundItemsInputSchema
>;
export type CreateReturnRefundApplicationInput = z.output<
  typeof createReturnRefundApplicationInputSchema
>;
