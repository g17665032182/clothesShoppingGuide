import {
  chatCardSchema,
  chatCardSelectionSchema,
  restoreProductResults,
} from './chat-display.projection.js';
import type {
  ChatCard,
  ChatCardSelection,
  ChatCardSourceRegistry,
  ChatOrderCardSummary,
  ChatProductCard,
} from './chat-display.types.js';

export function createChatCardSourceRegistry(): ChatCardSourceRegistry {
  const products = new Map<string, ChatProductCard>();
  const orders = new Map<string, ChatOrderCardSummary>();

  return {
    registerProducts(value) {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) return;
      const restored = restoreProductResults(serialized);
      if (!restored) return;
      for (const item of restored.items) products.set(item.externalId, item);
    },
    registerOrders(value) {
      if (!Array.isArray(value)) return;
      for (const order of value) {
        const parsed = chatCardSchema.safeParse({
          type: 'card',
          name: 'order',
          data: { items: [order] },
        });
        if (!parsed.success || parsed.data.name !== 'order') continue;
        const safeOrder = parsed.data.data.items[0];
        if (safeOrder) orders.set(safeOrder.orderNo, safeOrder);
      }
    },
    createCard(selection: ChatCardSelection): ChatCard {
      const parsedSelection = chatCardSelectionSchema.safeParse(selection);
      if (!parsedSelection.success) {
        throw new Error('卡片引用不符合安全要求');
      }

      if (parsedSelection.data.name === 'product') {
        const items = parsedSelection.data.externalIds.map((externalId) => {
          const product = products.get(externalId);
          if (!product) throw new Error('卡片引用不存在或不属于本轮查询');
          return product;
        });
        return {
          type: 'card',
          name: 'product',
          data: { items },
        };
      }

      const items = parsedSelection.data.orderNos.map((orderNo) => {
        const order = orders.get(orderNo);
        if (!order) throw new Error('卡片引用不存在或不属于本轮查询');
        return order;
      });
      return {
        type: 'card',
        name: 'order',
        data: { items },
      };
    },
  };
}
