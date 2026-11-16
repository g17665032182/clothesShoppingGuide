import { tool } from '@langchain/core/tools';

import {
  shoppingRulesInputSchema,
  shoppingRulesResultSchema,
  type ShoppingRulesInput,
} from '../dto/shopping-rules.dto.js';
import { readShoppingRules } from '../knowledge/shopping-rules.catalog.js';

export function createChatShoppingRulesTool(onRequested: () => void) {
  return tool(
    async (input: ShoppingRulesInput) => {
      try {
        // 系统规则不作为个人偏好来源，读取失败也保留本轮来源隔离。
        onRequested();
        const result = readShoppingRules(input.topic);
        const parsed = shoppingRulesResultSchema.safeParse({
          ok: result.ok,
          scope: result.scope,
          source: result.source,
          version: result.version,
          topic: result.topic,
          title: result.title,
          statements: [...result.statements],
          sourceDocumentIds: [...result.sourceDocumentIds],
          notice: result.notice,
        });
        if (
          !parsed.success ||
          !parsed.data.ok ||
          parsed.data.topic !== input.topic
        )
          return JSON.stringify({ ok: false, code: 'unavailable' });
        return JSON.stringify(parsed.data);
      } catch {
        // 固定失败不回传异常，不能用模型知识补齐缺失的政策。
        return JSON.stringify({ ok: false, code: 'unavailable' });
      }
    },
    {
      name: 'get_shopping_rules',
      description:
        '查询本站当前系统的固定购物规则，topic 必须为 shipping（运费）、payment（模拟付款）、cancellation（待付款取消）、fulfillment（本地履约）或 after_sales（售后能力范围），每次一个主题。仅使用已确认项目契约，不是第三方商家政策或法律判断；系统未接入售后不代表用户没有相关权利。不查询具体订单或退款进度，不办理支付、取消、退款、退换货或确认收货。',
      schema: shoppingRulesInputSchema,
    },
  );
}
