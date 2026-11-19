import { apiRequest } from '@/api';
import type {
  CreateReturnRefundApplicationPayload,
  ReturnRefundApplication,
  ReturnRefundApplicationPage,
  ReturnRefundApplicationQuery,
  ReturnRefundOrderOptions,
  ReturnRefundShipmentPayload,
} from '@/api/types/return-refund';

function toQuery(query: ReturnRefundApplicationQuery): string {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.status) params.set('status', query.status);
  return params.toString();
}

export function getReturnRefundOptions(
  token: string,
  orderId: string,
  signal?: AbortSignal,
): Promise<ReturnRefundOrderOptions> {
  return apiRequest<ReturnRefundOrderOptions>(
    `/orders/${encodeURIComponent(orderId)}/return-refund-options`,
    { token, signal },
  );
}

export function createReturnRefundApplication(
  token: string,
  orderId: string,
  payload: CreateReturnRefundApplicationPayload,
  signal?: AbortSignal,
): Promise<ReturnRefundApplication> {
  return apiRequest<ReturnRefundApplication>(
    `/orders/${encodeURIComponent(orderId)}/return-refund-applications`,
    { method: 'POST', token, signal, data: payload },
  );
}

export function listReturnRefundApplications(
  token: string,
  query: ReturnRefundApplicationQuery,
  signal?: AbortSignal,
): Promise<ReturnRefundApplicationPage> {
  return apiRequest<ReturnRefundApplicationPage>(
    `/return-refund-applications?${toQuery(query)}`,
    { token, signal },
  );
}

export function getReturnRefundApplication(
  token: string,
  applicationId: string,
  signal?: AbortSignal,
): Promise<ReturnRefundApplication> {
  return apiRequest<ReturnRefundApplication>(
    `/return-refund-applications/${encodeURIComponent(applicationId)}`,
    { token, signal },
  );
}

export function submitReturnRefundDraft(
  token: string,
  applicationId: string,
  version: number,
  signal?: AbortSignal,
): Promise<ReturnRefundApplication> {
  return apiRequest<ReturnRefundApplication>(
    `/return-refund-applications/${encodeURIComponent(applicationId)}/submit`,
    { method: 'POST', token, signal, data: { version } },
  );
}

export function cancelReturnRefundApplication(
  token: string,
  applicationId: string,
  signal?: AbortSignal,
): Promise<ReturnRefundApplication> {
  return apiRequest<ReturnRefundApplication>(
    `/return-refund-applications/${encodeURIComponent(applicationId)}/cancel`,
    { method: 'POST', token, signal, data: {} },
  );
}

export function submitReturnRefundShipment(
  token: string,
  applicationId: string,
  payload: ReturnRefundShipmentPayload,
  signal?: AbortSignal,
): Promise<ReturnRefundApplication> {
  return apiRequest<ReturnRefundApplication>(
    `/return-refund-applications/${encodeURIComponent(applicationId)}/return-shipment`,
    { method: 'POST', token, signal, data: payload },
  );
}

export type ReturnRefundEvidenceUploadResult = {
  id: string;
  mediaType: string;
  byteSize: number;
  createdAt: string;
};

export function uploadReturnRefundEvidence(
  token: string,
  applicationId: string,
  file: File,
  signal?: AbortSignal,
): Promise<ReturnRefundEvidenceUploadResult> {
  const body = new FormData();
  body.append('file', file);
  return apiRequest<ReturnRefundEvidenceUploadResult>(
    `/return-refund-applications/${encodeURIComponent(applicationId)}/evidence`,
    { method: 'POST', token, signal, data: body },
  );
}

export function deleteReturnRefundEvidence(
  token: string,
  applicationId: string,
  evidenceId: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiRequest<void>(
    `/return-refund-applications/${encodeURIComponent(applicationId)}/evidence/${encodeURIComponent(evidenceId)}`,
    { method: 'DELETE', token, signal },
  );
}

export function downloadReturnRefundEvidence(
  token: string,
  applicationId: string,
  evidenceId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  return apiRequest<Blob>(
    `/return-refund-applications/${encodeURIComponent(applicationId)}/evidence/${encodeURIComponent(evidenceId)}`,
    { token, signal, responseType: 'blob' },
  );
}
