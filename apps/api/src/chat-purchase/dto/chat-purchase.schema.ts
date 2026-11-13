import { z } from 'zod';

const boundedText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .regex(/^[^\u0000-\u001f\u007f]*$/u);
const version = z.number().int().safe().positive();
const recipientPatch = z.strictObject({
  name: boundedText(100).nullable().optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?\d{6,20}$/u)
    .nullable()
    .optional(),
  address: boundedText(500).nullable().optional(),
});

export const purchaseConversationParamsSchema = z.strictObject({
  conversationId: z.uuid(),
});
export const purchaseDraftParamsSchema =
  purchaseConversationParamsSchema.extend({
    draftId: z.uuid(),
  });
export const purchaseEmptyQuerySchema = z.strictObject({});
export const startPurchaseSchema = z.strictObject({
  productExternalId: boundedText(160),
  expectedVersion: version.nullable(),
});
export const patchPurchaseSchema = z
  .strictObject({
    expectedVersion: version,
    skuId: z.uuid().nullable().optional(),
    quantity: z.number().int().min(1).max(99).optional(),
    recipient: recipientPatch.optional(),
  })
  .refine(
    (value) =>
      value.skuId !== undefined ||
      value.quantity !== undefined ||
      (value.recipient !== undefined &&
        Object.values(value.recipient).some((field) => field !== undefined)),
    { message: '至少提供一个可修改字段' },
  );
export const purchaseVersionSchema = z.strictObject({
  expectedVersion: version,
});
export const selectPurchaseAddressSchema = z.strictObject({
  addressId: z.uuid(),
  expectedVersion: version,
});
export type StartPurchaseInput = z.infer<typeof startPurchaseSchema>;
export type PatchPurchaseInput = z.infer<typeof patchPurchaseSchema>;
export type PurchaseVersionInput = z.infer<typeof purchaseVersionSchema>;
export type SelectPurchaseAddressInput = z.infer<
  typeof selectPurchaseAddressSchema
>;
