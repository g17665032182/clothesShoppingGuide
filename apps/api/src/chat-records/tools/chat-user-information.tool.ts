import { tool } from '@langchain/core/tools';

import { getMyInformationSchema } from '../../chat-user-information/index.js';
import type { GetMyInformationInput } from '../../chat-user-information/index.js';
import { PurchaseAddressCoordinator } from './purchase-address-coordinator.js';

export function createChatUserInformationTool(
  coordinator: PurchaseAddressCoordinator,
  onTryOnTasksRequested?: () => void,
) {
  return tool(
    async (input: GetMyInformationInput) => {
      // schema 已解析通过；查询失败也要保留整轮来源隔离标记。
      if (input.sections.includes('try_on_tasks')) onTryOnTasksRequested?.();
      const result = await coordinator.lookup(input);
      return JSON.stringify(result);
    },
    {
      name: 'get_my_information',
      description:
        '查询当前用户本人的地址、订单、已保存图片或试穿任务安全摘要。只查询用户明确需要的 section；试穿任务须显式指定 try_on_tasks，可用 tryOnStatus 筛选四种状态，每页5条、页码1至10。“上次”指最新创建的未删除任务；失败不等于无记录，不估算完成时间或评价未读取的图片，resultAvailable 不保证下载成功。不得请求或编造他人信息。',
      schema: getMyInformationSchema,
    },
  );
}
