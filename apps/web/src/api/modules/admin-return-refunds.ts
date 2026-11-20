import { apiRequest } from '@/api';
import type {
  AdminReturnRefundApplication,
  AdminReturnRefundApplicationPage,
  AdminReturnRefundQuery,
  RejectReturnRefundPayload,
  ReturnRefundActionPayload,
} from '@/api/types/admin-return-refunds';

const basePath = '/admin/return-refund-applications';

function toQuery(query: AdminReturnRefundQuery): string {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.status) params.set('status', query.status);
  if (query.manualReviewRequired !== undefined)
    params.set('manualReviewRequired', String(query.manualReviewRequired));
  if (query.orderNo) params.set('orderNo', query.orderNo);
  return params.toString();
}

export function listAdminReturnRefundApplications(
  token: string,
  query: AdminReturnRefundQuery,
  signal?: AbortSignal,
): Promise<AdminReturnRefundApplicationPage> {
  return apiRequest<AdminReturnRefundApplicationPage>(
    `${basePath}?${toQuery(query)}`,
    { token, signal },
  );
}

export function getAdminReturnRefundApplication(
  token: string,
  applicationId: string,
  signal?: AbortSignal,
): Promise<AdminReturnRefundApplication> {
  return apiRequest<AdminReturnRefundApplication>(
    `${basePath}/${encodeURIComponent(applicationId)}`,
    { token, signal },
  );
}

function runAction(
  token: string,
  applicationId: string,
  action: 'approve' | 'received' | 'refund-processing' | 'refunded',
  payload: ReturnRefundActionPayload,
  signal?: AbortSignal,
): Promise<AdminReturnRefundApplication> {
  return apiRequest<AdminReturnRefundApplication>(
    `${basePath}/${encodeURIComponent(applicationId)}/${action}`,
    { method: 'POST', token, signal, data: payload },
  );
}

export const approveReturnRefund = (
  token: string,
  applicationId: string,
  payload: ReturnRefundActionPayload,
  signal?: AbortSignal,
) => runAction(token, applicationId, 'approve', payload, signal);

export function rejectReturnRefund(
  token: string,
  applicationId: string,
  payload: RejectReturnRefundPayload,
  signal?: AbortSignal,
): Promise<AdminReturnRefundApplication> {
  return apiRequest<AdminReturnRefundApplication>(
    `${basePath}/${encodeURIComponent(applicationId)}/reject`,
    { method: 'POST', token, signal, data: payload },
  );
}

export const receiveReturnRefund = (
  token: string,
  applicationId: string,
  payload: ReturnRefundActionPayload,
  signal?: AbortSignal,
) => runAction(token, applicationId, 'received', payload, signal);

export const startReturnRefund = (
  token: string,
  applicationId: string,
  payload: ReturnRefundActionPayload,
  signal?: AbortSignal,
) => runAction(token, applicationId, 'refund-processing', payload, signal);

export const completeReturnRefund = (
  token: string,
  applicationId: string,
  payload: ReturnRefundActionPayload,
  signal?: AbortSignal,
) => runAction(token, applicationId, 'refunded', payload, signal);

export function downloadAdminReturnRefundEvidence(
  token: string,
  applicationId: string,
  evidenceId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  return apiRequest<Blob>(
    `${basePath}/${encodeURIComponent(applicationId)}/evidence/${encodeURIComponent(evidenceId)}`,
    { token, signal, responseType: 'blob' },
  );
}
