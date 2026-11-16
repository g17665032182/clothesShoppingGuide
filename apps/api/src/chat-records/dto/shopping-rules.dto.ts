import { z } from 'zod';

export const SHOPPING_RULES_VERSION = '2026-11-17.v1';
export const SHOPPING_RULES_NOTICE =
  '仅说明本站当前系统规则，不代表第三方商家政策、法定权利判断或售后受理结果。';

export const shoppingRulesTopicSchema = z.enum([
  'shipping',
  'payment',
  'cancellation',
  'fulfillment',
  'after_sales',
]);

export const shoppingRulesSourceDocumentIdSchema = z.enum([
  'order-crud-contract',
  'chat-tool-order-fulfillment-crud-contract',
  'security-and-business-boundaries',
]);

const safeText = (maximum: number) =>
  z
    .string()
    .regex(/^[^\u0000-\u001f\u007f]*$/u)
    .trim()
    .min(1)
    .max(maximum);

export const shoppingRulesInputSchema = z.strictObject({
  topic: shoppingRulesTopicSchema,
});

const shoppingRulesSuccessSchema = z.strictObject({
  ok: z.literal(true),
  scope: z.literal('site_capabilities'),
  source: z.literal('approved_project_contracts'),
  version: z.literal(SHOPPING_RULES_VERSION),
  topic: shoppingRulesTopicSchema,
  title: safeText(40),
  statements: z.array(safeText(300)).min(1).max(5),
  sourceDocumentIds: z
    .array(shoppingRulesSourceDocumentIdSchema)
    .min(1)
    .max(3)
    .refine((sources) => new Set(sources).size === sources.length, {
      message: '规则来源不得重复',
    }),
  notice: z.literal(SHOPPING_RULES_NOTICE),
});

export const shoppingRulesResultSchema = z.discriminatedUnion('ok', [
  shoppingRulesSuccessSchema,
  z.strictObject({
    ok: z.literal(false),
    code: z.literal('unavailable'),
  }),
]);

export type ShoppingRulesTopic = z.output<typeof shoppingRulesTopicSchema>;
export type ShoppingRulesSourceDocumentId = z.output<
  typeof shoppingRulesSourceDocumentIdSchema
>;
export type ShoppingRulesSchemaInput = z.input<typeof shoppingRulesInputSchema>;
export type ShoppingRulesInput = z.output<typeof shoppingRulesInputSchema>;
export type ShoppingRulesSuccess = z.output<typeof shoppingRulesSuccessSchema>;
export type ShoppingRulesResult = z.output<typeof shoppingRulesResultSchema>;
