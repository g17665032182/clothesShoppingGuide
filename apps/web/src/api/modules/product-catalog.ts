import { apiRequest } from '@/api';
import type {
  ChatProductCard,
  ChatProductResults,
  ProductSearchQuery,
} from '@/api/types/chat';

type ProductPageResponse = Pick<
  ChatProductResults,
  'items' | 'nextCursor' | 'noResultReason'
>;

export function getNextProductPage(
  token: string,
  query: ProductSearchQuery,
  cursor: string,
  signal?: AbortSignal,
): Promise<ProductPageResponse> {
  return apiRequest<ProductPageResponse>('/product-catalog/next-page', {
    method: 'POST',
    token,
    signal,
    data: { query, cursor },
  });
}

export function isProductPageResponse(
  value: unknown,
): value is ProductPageResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Partial<ProductPageResponse>;
  return (
    Array.isArray(response.items) &&
    response.items.every(isProductCard) &&
    (response.nextCursor === null || typeof response.nextCursor === 'string') &&
    (response.noResultReason === null ||
      [
        'NO_MATCHING_SIZE',
        'OVER_BUDGET',
        'OUT_OF_STOCK',
        'NO_MATCHING_PRODUCT',
      ].includes(response.noResultReason ?? ''))
  );
}

function isProductCard(value: unknown): value is ChatProductCard {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ChatProductCard>;
  return (
    typeof item.externalId === 'string' &&
    typeof item.name === 'string' &&
    typeof item.category === 'string' &&
    typeof item.price === 'string' &&
    item.currency === 'CNY' &&
    Array.isArray(item.sizes) &&
    Array.isArray(item.colors) &&
    typeof item.inStock === 'boolean' &&
    typeof item.tryOnEnabled === 'boolean' &&
    Array.isArray(item.matchReasons)
  );
}
