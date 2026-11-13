import { tool } from '@langchain/core/tools';

import { getMyInformationSchema } from '../../chat-user-information/index.js';
import type { GetMyInformationInput } from '../../chat-user-information/index.js';
import { PurchaseAddressCoordinator } from './purchase-address-coordinator.js';

export function createChatUserInformationTool(
  coordinator: PurchaseAddressCoordinator,
) {
  return tool(
    async (input: GetMyInformationInput) => {
      const result = await coordinator.lookup(input);
      return JSON.stringify(result);
    },
    {
      name: 'get_my_information',
      description:
        '查询当前用户本人的地址、订单或已保存图片摘要。只查询用户明确需要的 section；不得请求或编造他人信息。',
      schema: getMyInformationSchema,
    },
  );
}
