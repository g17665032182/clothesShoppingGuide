import { apiRequest } from '@/api';
import type { OrderDetail, OrderPage, OrderQuery } from '@/api/types/orders';

function toQuery(query: OrderQuery): string {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.status) params.set('status', query.status);
  if (query.orderNo) params.set('orderNo', query.orderNo);
  return params.toString();
}

export function listOrders(
  token: string,
  query: OrderQuery,
  signal?: AbortSignal,
): Promise<OrderPage> {
  return apiRequest<OrderPage>(`/orders?${toQuery(query)}`, { token, signal });
}

export function getOrder(
  token: string,
  orderId: string,
  signal?: AbortSignal,
): Promise<OrderDetail> {
  return apiRequest<OrderDetail>(`/orders/${encodeURIComponent(orderId)}`, {
    token,
    signal,
  });
}

function orderAction(
  token: string,
  orderId: string,
  action: 'simulate-payment' | 'cancel' | 'confirm-receipt',
  signal?: AbortSignal,
): Promise<OrderDetail> {
  return apiRequest<OrderDetail>(
    `/orders/${encodeURIComponent(orderId)}/${action}`,
    { method: 'POST', token, signal, data: {} },
  );
}

export const simulatePayment = (
  token: string,
  orderId: string,
  signal?: AbortSignal,
) => orderAction(token, orderId, 'simulate-payment', signal);

export const cancelOrder = (
  token: string,
  orderId: string,
  signal?: AbortSignal,
) => orderAction(token, orderId, 'cancel', signal);

export const confirmReceipt = (
  token: string,
  orderId: string,
  signal?: AbortSignal,
) => orderAction(token, orderId, 'confirm-receipt', signal);
