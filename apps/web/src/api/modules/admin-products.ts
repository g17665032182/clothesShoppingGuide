import { ApiError, apiRequest } from '@/api';
import type {
  AdminProductDetail,
  AdminProductListResponse,
  AdminProductQuery,
} from '@/api/types/admin-products';

export async function listAdminProducts(
  token: string,
  query: AdminProductQuery,
  signal?: AbortSignal,
): Promise<AdminProductListResponse> {
  const response = await apiRequest<AdminProductListResponse>(
    '/admin/product-catalog/products',
    {
      token,
      signal,
      params: query,
    },
  );
  if (!isAdminProductListResponse(response))
    throw new ApiError('商品列表响应格式无效，请刷新后重试。', 502);
  return response;
}

export async function getAdminProduct(
  token: string,
  productId: string,
  signal?: AbortSignal,
): Promise<AdminProductDetail> {
  const response = await apiRequest<AdminProductDetail>(
    `/admin/product-catalog/products/${productId}`,
    { token, signal },
  );
  if (!isAdminProductDetail(response) || response.id !== productId)
    throw new ApiError('商品详情响应格式无效，请刷新后重试。', 502);
  return response;
}

export async function updateAdminProductTryOn(
  token: string,
  productId: string,
  tryOnEnabled: boolean,
  signal?: AbortSignal,
): Promise<AdminProductDetail> {
  const response = await apiRequest<AdminProductDetail>(
    `/admin/product-catalog/products/${productId}/try-on`,
    {
      method: 'PATCH',
      token,
      signal,
      data: { tryOnEnabled },
    },
  );
  if (!isAdminProductDetail(response) || response.id !== productId)
    throw new ApiError('商品配置响应格式无效，请重新读取状态。', 502);
  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isProductSummary(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.externalId === 'string' &&
    typeof value.name === 'string' &&
    (value.brand === null || typeof value.brand === 'string') &&
    typeof value.category === 'string' &&
    ['tops', 'bottoms', 'dresses', 'outerwear', 'shoes'].includes(
      value.category,
    ) &&
    (value.productUrl === null || typeof value.productUrl === 'string') &&
    typeof value.isActive === 'boolean' &&
    typeof value.tryOnEnabled === 'boolean' &&
    typeof value.skuCount === 'number' &&
    (value.lowestPrice === null || typeof value.lowestPrice === 'string') &&
    typeof value.totalStock === 'number' &&
    typeof value.totalAvailableStock === 'number' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

/** 管理接口需先通过白名单结构检查，异常响应不能进入页面状态。 */
export function isAdminProductListResponse(
  value: unknown,
): value is AdminProductListResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isProductSummary) &&
    typeof value.total === 'number' &&
    typeof value.page === 'number' &&
    typeof value.pageSize === 'number'
  );
}

export function isAdminProductDetail(
  value: unknown,
): value is AdminProductDetail {
  if (!isRecord(value) || !isProductSummary(value)) return false;
  return (
    (value.description === null || typeof value.description === 'string') &&
    ['styles', 'occasions', 'fits'].every(
      (key) =>
        Array.isArray(value[key]) &&
        value[key].every((item: unknown) => typeof item === 'string'),
    ) &&
    Array.isArray(value.skus) &&
    value.skus.every(
      (sku: unknown) =>
        isRecord(sku) &&
        typeof sku.id === 'string' &&
        typeof sku.externalSkuId === 'string' &&
        typeof sku.color === 'string' &&
        typeof sku.size === 'string' &&
        typeof sku.price === 'string' &&
        sku.currency === 'CNY' &&
        typeof sku.stock === 'number' &&
        typeof sku.reservedStock === 'number' &&
        typeof sku.availableStock === 'number' &&
        (sku.imageUrl === null || typeof sku.imageUrl === 'string') &&
        typeof sku.isActive === 'boolean',
    )
  );
}
