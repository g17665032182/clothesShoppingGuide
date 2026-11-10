import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

import { createListShippingAddressesTool } from '../tool/list-shipping-addresses.tool.js';

test('本人地址工具只返回引用并拒绝 userId 参数', async () => {
  const userId = randomUUID();
  let boundUserId = '';
  const tool = createListShippingAddressesTool(
    {
      listForUser: async (requestedUserId: string) => {
        boundUserId = requestedUserId;
        return {
          items: [
            {
              id: randomUUID(),
              recipientName: '测试姓名',
              phone: '13800138000',
              address: '测试详细地址',
              label: '包含隐私的自由标签',
              isDefault: true,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        };
      },
    } as never,
    userId,
  );
  const result = await tool.invoke({});
  assert.equal(boundUserId, userId);
  assert.doesNotMatch(result, /测试姓名|13800138000|测试详细地址|自由标签/u);
  assert.equal(tool.schema.safeParse({ userId }).success, false);
});
