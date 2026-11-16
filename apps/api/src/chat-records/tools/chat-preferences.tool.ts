import { tool } from '@langchain/core/tools';

import {
  preferenceChatQuerySchema,
  preferenceChatResultSchema,
  type PreferenceChatQuery,
  type UserPreferencesReader,
} from '../../user-preferences/index.js';

export function createChatPreferencesTool(
  reader: Pick<UserPreferencesReader, 'listForChat'>,
  userId: string,
  onRequested: () => void,
) {
  return tool(
    async (input: PreferenceChatQuery) => {
      // 身份仅来自本轮服务端上下文；失败及关闭偏好时同样保留来源标记。
      onRequested();
      try {
        const result = await reader.listForChat(userId, input);
        const projection = result.ok
          ? {
              ok: result.ok,
              items: result.items.map((item) => ({
                category: item.category,
                valueType: item.valueType,
                value: item.value,
                isPrimary: item.isPrimary,
                updatedAt: item.updatedAt,
              })),
              page: result.page,
              pageSize: result.pageSize,
              total: result.total,
              hasNext: result.hasNext,
            }
          : { ok: result.ok, code: result.code };
        // 领域 schema 同时校验类别对应的嵌套值，不能把任意 JSON 当作安全偏好。
        const parsed = preferenceChatResultSchema.safeParse(projection);
        return JSON.stringify(
          parsed.success ? parsed.data : { ok: false, code: 'unavailable' },
        );
      } catch {
        return JSON.stringify({ ok: false, code: 'unavailable' });
      }
    },
    {
      name: 'get_my_preferences',
      description:
        '查询当前用户本人已保存且启用的结构化服装偏好，可按 category 筛选，每页5条、页码1至10。空列表表示没有匹配偏好；preferences_disabled 表示用户已关闭偏好读取，不代表没有保存记录。仅查询，不修改偏好或记忆。',
      schema: preferenceChatQuerySchema,
    },
  );
}
