import { apiRequest } from '@/api';
import type {
  PatchPurchasePayload,
  PurchaseDraftResponse,
  PurchaseDraft,
  PurchaseSkuPage,
  PurchaseVersionPayload,
  SelectPurchaseAddressPayload,
  StartPurchasePayload,
} from '@/api/types/chat-purchase';

const purchasePath = (conversationId: string) =>
  `/chat/conversations/${encodeURIComponent(conversationId)}/purchase-draft`;

export function getPurchaseDraft(
  token: string,
  conversationId: string,
  signal?: AbortSignal,
): Promise<PurchaseDraftResponse> {
  return apiRequest<PurchaseDraftResponse>(purchasePath(conversationId), {
    token,
    signal,
  });
}

export function startPurchase(
  token: string,
  conversationId: string,
  payload: StartPurchasePayload,
  signal?: AbortSignal,
): Promise<PurchaseDraftResponse> {
  return apiRequest<PurchaseDraftResponse>(
    `${purchasePath(conversationId)}/start`,
    {
      method: 'POST',
      token,
      signal,
      data: payload,
    },
  );
}

export function patchPurchaseDraft(
  token: string,
  conversationId: string,
  draftId: string,
  payload: PatchPurchasePayload,
  signal?: AbortSignal,
): Promise<PurchaseDraft> {
  return apiRequest<PurchaseDraft>(
    `${purchasePath(conversationId)}/${encodeURIComponent(draftId)}`,
    { method: 'PATCH', token, signal, data: payload },
  );
}

export function discardPurchaseDraft(
  token: string,
  conversationId: string,
  draftId: string,
  payload: PurchaseVersionPayload,
  signal?: AbortSignal,
): Promise<PurchaseDraft> {
  return apiRequest<PurchaseDraft>(
    `${purchasePath(conversationId)}/${encodeURIComponent(draftId)}/discard`,
    { method: 'POST', token, signal, data: payload },
  );
}

export function confirmPurchase(
  token: string,
  conversationId: string,
  draftId: string,
  payload: PurchaseVersionPayload,
  signal?: AbortSignal,
): Promise<PurchaseDraftResponse> {
  return apiRequest<PurchaseDraftResponse>(
    `${purchasePath(conversationId)}/${encodeURIComponent(draftId)}/confirm`,
    { method: 'POST', token, signal, data: payload },
  );
}

export function selectPurchaseAddress(
  token: string,
  conversationId: string,
  draftId: string,
  payload: SelectPurchaseAddressPayload,
  signal?: AbortSignal,
): Promise<PurchaseDraft> {
  return apiRequest<PurchaseDraft>(
    `${purchasePath(conversationId)}/${encodeURIComponent(draftId)}/select-address`,
    { method: 'POST', token, signal, data: payload },
  );
}

export function listPurchaseSkus(
  token: string,
  productExternalId: string,
  page = 1,
  pageSize = 100,
  signal?: AbortSignal,
): Promise<PurchaseSkuPage> {
  return apiRequest<PurchaseSkuPage>('/product-catalog/skus', {
    token,
    signal,
    params: { productExternalId, page, pageSize },
  });
}
