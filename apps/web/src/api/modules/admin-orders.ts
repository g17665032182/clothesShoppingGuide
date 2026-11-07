import { apiRequest } from '@/api';
import type {
  AdminOrderDetail,
  AdminOrderPage,
  AdminOrderQuery,
  ShipOrderPayload,
} from '@/api/types/admin-orders';

function toQuery(query: AdminOrderQuery): string {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.status) params.set('status', query.status);
  if (query.orderNo) params.set('orderNo', query.orderNo);
  if (query.userId) params.set('userId', query.userId);
  return params.toString();
}

export function listAdminOrders(
  token: string,
  query: AdminOrderQuery,
  signal?: AbortSignal,
): Promise<AdminOrderPage> {
  return apiRequest<AdminOrderPage>(`/admin/orders?${toQuery(query)}`, {
    token,
    signal,
  });
}

export function getAdminOrder(
  token: string,
  orderId: string,
  signal?: AbortSignal,
): Promise<AdminOrderDetail> {
  return apiRequest<AdminOrderDetail>(`/admin/orders/${orderId}`, {
    token,
    signal,
  });
}

export function shipAdminOrder(
  token: string,
  orderId: string,
  payload: ShipOrderPayload,
  signal?: AbortSignal,
): Promise<AdminOrderDetail> {
  return apiRequest<AdminOrderDetail>(`/admin/orders/${orderId}/ship`, {
    method: 'POST',
    token,
    signal,
    data: payload,
  });
}
