import { z } from 'zod';

import {
  getPreferenceValueType,
  preferenceCategorySchema,
  preferenceValueByCategorySchema,
  type PreferenceCategory,
  type PreferenceValue,
} from '../context/preference-value.schema.js';
import { containsSensitivePreferenceText } from '../context/preference-safety.js';

const page = z.number().int().safe().min(1).max(10);

export const preferenceChatQuerySchema = z.strictObject({
  category: preferenceCategorySchema.optional(),
  page: page.default(1),
});

const createChatItemVariant = <Category extends PreferenceCategory>(
  category: Category,
) => {
  const valueSchema: z.ZodType<PreferenceValue> =
    preferenceValueByCategorySchema.options.find(
      (option) => option.shape.category.value === category,
    )!.shape.value;

  // 沿用领域的类别和值结构，只增加聊天白名单；损坏记录不得靠覆盖类型修复。
  return z.strictObject({
    category: z.literal(category),
    valueType: z.literal(getPreferenceValueType(category)),
    value: valueSchema.refine(
      (value) => !containsSensitivePreferenceText(value),
      '偏好值不符合安全要求',
    ),
    isPrimary: z.boolean(),
    updatedAt: z.iso.datetime(),
  });
};

export const preferenceChatItemSchema = z.discriminatedUnion('category', [
  createChatItemVariant('size'),
  createChatItemVariant('shoe_size'),
  createChatItemVariant('fit'),
  createChatItemVariant('style'),
  createChatItemVariant('color'),
  createChatItemVariant('occasion'),
  createChatItemVariant('budget'),
  createChatItemVariant('avoidance'),
  createChatItemVariant('purchase_preference'),
]);

const preferenceChatPageSchema = z
  .strictObject({
    ok: z.literal(true),
    items: z.array(preferenceChatItemSchema).max(5),
    page,
    pageSize: z.literal(5),
    total: z.number().int().safe().nonnegative(),
    hasNext: z.boolean(),
  })
  .superRefine((result, context) => {
    const offset = (result.page - 1) * 5;
    const expectedItems = Math.max(0, Math.min(5, result.total - offset));
    if (result.items.length !== expectedItems) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: '偏好分页条数与总数不一致',
      });
    }
    if (result.hasNext !== result.page * 5 < result.total) {
      context.addIssue({
        code: 'custom',
        path: ['hasNext'],
        message: '偏好分页后续标记与总数不一致',
      });
    }
  });

export const preferenceChatResultSchema = z.discriminatedUnion('ok', [
  preferenceChatPageSchema,
  z.strictObject({
    ok: z.literal(false),
    code: z.enum(['preferences_disabled', 'unavailable']),
  }),
]);

export type PreferenceChatQueryInput = z.input<
  typeof preferenceChatQuerySchema
>;
export type PreferenceChatQuery = z.output<typeof preferenceChatQuerySchema>;
export type PreferenceChatResult = z.output<typeof preferenceChatResultSchema>;
