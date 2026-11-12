import { tool, type StructuredToolInterface } from '@langchain/core/tools';

import {
  chatCardSelectionSchema,
  chatCardSchema,
} from './chat-display.projection.js';
import type { ChatCard, ChatCardSourceRegistry } from './chat-display.types.js';

export function createChatCardDisplayTool(
  registry: ChatCardSourceRegistry,
  onCard: (card: ChatCard) => ChatCard,
): StructuredToolInterface {
  return tool(
    async (selection) => {
      const parsedSelection = chatCardSelectionSchema.safeParse(selection);
      if (!parsedSelection.success) {
        return JSON.stringify({ ok: false, code: 'invalid_reference' });
      }

      let card: ChatCard;
      try {
        card = registry.createCard(parsedSelection.data);
      } catch {
        return JSON.stringify({ ok: false, code: 'invalid_reference' });
      }

      try {
        const staged = onCard(card);
        const parsedCard = chatCardSchema.safeParse(staged);
        if (!parsedCard.success) {
          return JSON.stringify({ ok: false, code: 'unavailable' });
        }
        return JSON.stringify(parsedCard.data);
      } catch {
        // 不把预算、投影或内部实现异常回显给模型或写入工具结果。
        return JSON.stringify({ ok: false, code: 'unavailable' });
      }
    },
    {
      name: 'display_chat_card',
      description:
        '展示本轮已查询的商品或本人订单。只能提供 name 和已查询结果中的 externalIds/orderNos，不得编写商品或订单数据。订单卡只读。',
      schema: chatCardSelectionSchema,
    },
  );
}
