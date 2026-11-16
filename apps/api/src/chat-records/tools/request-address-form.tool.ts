import { tool } from '@langchain/core/tools';
import { z } from 'zod';

// 严格空对象可阻止模型携带目标路由、身份或地址字段。
export const requestAddressFormSchema = z.strictObject({});

export function createRequestAddressFormTool(onRequested: () => void) {
  return tool(
    async () => {
      try {
        onRequested();
        return JSON.stringify({ ok: true, code: 'requested' });
      } catch {
        return JSON.stringify({ ok: false, code: 'unavailable' });
      }
    },
    {
      name: 'request_address_form',
      description:
        '仅当用户明确要求管理、添加或修改本人收货地址时，请求打开现有地址管理页面。不会读取、展示或修改地址，也不能据此声称地址已保存或页面已打开。',
      schema: requestAddressFormSchema,
    },
  );
}
