import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export function createRequestPurchaseFormTool(
  canOpen: () => Promise<boolean>,
  onRequested: () => void,
) {
  return tool(
    async () => {
      try {
        if (!(await canOpen())) {
          return JSON.stringify({ ok: false, code: 'no_editable_draft' });
        }
        onRequested();
        return JSON.stringify({ ok: true, requested: true });
      } catch {
        return JSON.stringify({ ok: false, code: 'unavailable' });
      }
    },
    {
      name: 'request_purchase_form',
      description:
        '仅当用户需要处理本人当前购买草稿时请求前端打开购买弹框。必须已有可编辑草稿；不会创建、修改或确认购买。',
      schema: z.strictObject({}),
    },
  );
}
