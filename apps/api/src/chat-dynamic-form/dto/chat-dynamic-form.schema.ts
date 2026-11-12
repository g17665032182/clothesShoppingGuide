import { z } from 'zod';

import {
  DYNAMIC_FORM_FIELD_TYPES,
  DYNAMIC_FORM_STATUSES,
} from './chat-dynamic-form-response.js';

const plainText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .regex(/^[^\u0000-\u001f\u007f]*$/u);

const optionSchema = z.strictObject({
  value: plainText(160),
  label: plainText(200),
});

const commonField = {
  key: plainText(160),
  label: plainText(200),
  required: z.boolean(),
  placeholder: plainText(200).nullable().optional(),
};

export const dynamicFormFieldSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...commonField,
    type: z.literal('text'),
    options: z.never().optional(),
  }),
  z.strictObject({
    ...commonField,
    type: z.literal('textarea'),
    options: z.never().optional(),
  }),
  z.strictObject({
    ...commonField,
    type: z.literal('tel'),
    options: z.never().optional(),
  }),
  z.strictObject({
    ...commonField,
    type: z.literal('number'),
    options: z.never().optional(),
  }),
  z.strictObject({
    ...commonField,
    type: z.literal('checkbox'),
    options: z.never().optional(),
  }),
  z.strictObject({
    ...commonField,
    type: z.literal('select'),
    options: z.array(optionSchema).min(1).max(50),
  }),
]);

export const dynamicFormRequestSchema = z
  .strictObject({
    formKind: z.literal('purchase_recipient'),
    fields: z.array(dynamicFormFieldSchema).min(1).max(20),
    title: plainText(200),
    description: plainText(500).nullable().optional(),
    submitLabel: plainText(80).optional(),
  })
  .refine(
    (value) =>
      new Set(value.fields.map((field) => field.key)).size ===
      value.fields.length,
    { message: '表单字段 key 不能重复', path: ['fields'] },
  );

const atom = z.union([z.string().max(500), z.number().finite(), z.boolean()]);

export const dynamicFormRouteParamsSchema = z.strictObject({
  conversationId: z.uuid(),
  formId: z.uuid(),
});

export const dynamicFormSubmitSchema = z.strictObject({
  revision: z.number().int().positive(),
  values: z
    .record(z.string().trim().min(1).max(160), atom)
    .refine((value) => Object.keys(value).length <= 20, {
      message: '表单值数量超出限制',
      path: ['values'],
    }),
});

export const dynamicFormCancelSchema = z.strictObject({
  revision: z.number().int().positive(),
});

export const dynamicFormStatusSchema = z.enum(DYNAMIC_FORM_STATUSES);

export type DynamicFormRequestInput = z.output<typeof dynamicFormRequestSchema>;
export type DynamicFormSubmitInput = z.output<typeof dynamicFormSubmitSchema>;
export type DynamicFormCancelInput = z.output<typeof dynamicFormCancelSchema>;
export type DynamicFormRouteParams = z.output<
  typeof dynamicFormRouteParamsSchema
>;

export { DYNAMIC_FORM_FIELD_TYPES };
