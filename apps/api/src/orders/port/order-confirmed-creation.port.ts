import type { EntityManager } from '@mikro-orm/core';

import type { CreateOrderInput } from '../dto/create-order.dto.js';
import type { OrderDetailResponseDto } from '../dto/order-response.dto.js';

export const ORDER_CONFIRMED_CREATION_PORT = Symbol(
  'ORDER_CONFIRMED_CREATION_PORT',
);

export type ConfirmedOrderInput = Omit<CreateOrderInput, 'items'> & {
  items: [{ skuId: string; quantity: number }];
};

// 确认条件来自已锁定草稿，不能使用客户端提交的即时价格替代。
export type ConfirmedOrderSnapshot = {
  productExternalId: string;
  skuId: string;
  productName: string;
  color: string;
  size: string;
  currency: 'CNY';
  unitPrice: string;
  imageUrl: string | null;
  expiresAt: Date;
};

export type ConfirmedOrderResult =
  | { kind: 'created' | 'replayed'; order: OrderDetailResponseDto }
  | {
      kind:
        | 'quote_changed'
        | 'unavailable'
        | 'insufficient_stock'
        | 'draft_expired';
    };

export interface OrderConfirmedCreationPort {
  createConfirmedInTransaction(
    em: EntityManager,
    userId: string,
    input: ConfirmedOrderInput,
    expectedSnapshot: ConfirmedOrderSnapshot,
  ): Promise<ConfirmedOrderResult>;
}
