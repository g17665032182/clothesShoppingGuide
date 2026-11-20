import type { EntityManager } from '@mikro-orm/core';

export const ORDER_RETURN_REFUND_READER = Symbol('ORDER_RETURN_REFUND_READER');

export type ReturnRefundOrderStatus =
  | 'pending_payment'
  | 'pending_shipment'
  | 'pending_receipt'
  | 'completed'
  | 'closed';

export type ReturnRefundOrderItemSnapshot = {
  orderItemId: string;
  productName: string;
  productExternalId: string;
  color: string;
  size: string;
  imageUrl: string | null;
  unitPrice: string;
  quantity: number;
};

export type ReturnRefundOrderSnapshot = {
  id: string;
  orderNo: string;
  status: ReturnRefundOrderStatus;
  currency: string;
  completedAt: Date | null;
  items: ReturnRefundOrderItemSnapshot[];
};

export type ReturnRefundOrderCandidate = Omit<
  ReturnRefundOrderSnapshot,
  'items'
> & {
  itemCount: number;
};

export interface OrderReturnRefundReaderPort {
  listReturnRefundOrdersForUser(
    userId: string,
  ): Promise<ReturnRefundOrderCandidate[]>;
  getReturnRefundOrderForUser(
    userId: string,
    orderId: string,
  ): Promise<ReturnRefundOrderSnapshot | null>;
  getReturnRefundOrderInTransaction(
    em: EntityManager,
    userId: string,
    orderId: string,
  ): Promise<ReturnRefundOrderSnapshot | null>;
}
