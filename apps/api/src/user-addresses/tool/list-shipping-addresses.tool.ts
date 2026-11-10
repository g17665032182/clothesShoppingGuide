import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { UserAddressesService } from '../service/user-addresses.service.js';

const listShippingAddressesSchema = z.strictObject({
  page: z.number().int().min(1).max(10).default(1),
});

/** 工具闭包绑定当前用户，模型只能取得地址引用，不能提交用户标识。 */
export function createListShippingAddressesTool(
  addresses: UserAddressesService,
  userId: string,
) {
  return tool(
    async ({ page }) => {
      const result = await addresses.listForUser(userId, {
        page,
        pageSize: 20,
      });
      return JSON.stringify({
        items: result.items.map((address, index) => ({
          addressId: address.id,
          isDefault: address.isDefault,
          displayName: address.isDefault
            ? '默认地址'
            : `地址 ${(page - 1) * result.pageSize + index + 1}`,
        })),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      });
    },
    {
      name: 'list_my_shipping_addresses',
      description:
        '查询本人可选收货地址的安全引用，不返回姓名、电话或详细地址。',
      schema: listShippingAddressesSchema,
    },
  );
}
