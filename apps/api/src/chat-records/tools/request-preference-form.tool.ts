import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const preferenceFormCategorySchema = z.enum([
  'size',
  'shoe_size',
  'fit',
  'style',
  'color',
  'occasion',
  'budget',
  'avoidance',
  'purchase_preference',
]);

export const requestPreferenceFormSchema = z.strictObject({
  category: preferenceFormCategorySchema.optional(),
});

type RequestPreferenceFormInput = z.infer<typeof requestPreferenceFormSchema>;

export function createRequestPreferenceFormTool(
  onRequested: (category?: RequestPreferenceFormInput['category']) => void,
) {
  return tool(
    async ({ category }) => {
      try {
        onRequested(category);
        return JSON.stringify({
          ok: true,
          code: 'requested',
          ...(category ? { category } : {}),
        });
      } catch {
        return JSON.stringify({ ok: false, code: 'unavailable' });
      }
    },
    {
      name: 'request_preference_form',
      description:
        '仅当用户明确要求管理或修改本人已保存的穿衣偏好时，请求打开现有偏好管理页面。可选提供一个明确相关的偏好类别；不会读取、展示或修改偏好，也不能据此声称页面已打开。',
      schema: requestPreferenceFormSchema,
    },
  );
}
