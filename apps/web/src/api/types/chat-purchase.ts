import type { OrderDetail } from './orders';

export type PurchaseDraftStatus =
  | 'collecting'
  | 'ready'
  | 'submitted'
  | 'cancelled'
  | 'expired';

export type PurchaseIssueCode =
  | 'missing_field'
  | 'sku_selection_required'
  | 'product_unavailable'
  | 'sku_unavailable'
  | 'insufficient_stock'
  | 'price_changed'
  | 'specification_changed'
  | 'expired';

export type PurchaseIssue =
  | {
      code: 'missing_field';
      field: 'recipient.name' | 'recipient.phone' | 'recipient.address';
    }
  | { code: Exclude<PurchaseIssueCode, 'missing_field'> };

export type PurchaseRecipient = {
  name: string | null;
  phone: string | null;
  address: string | null;
};

export type PurchaseSkuOption = {
  skuId: string;
  productExternalId: string;
  productName: string;
  color: string;
  size: string;
  unitPrice: string;
  currency: 'CNY';
  inStock: boolean;
  imageUrl: string | null;
};

export type PurchaseSkuPage = {
  items: PurchaseSkuOption[];
  total: number;
  page: number;
  pageSize: number;
};

export type PurchaseConfirmation = {
  version: number;
  productExternalId: string;
  skuId: string;
  name: string;
  color: string;
  size: string;
  imageUrl: string | null;
  quantity: number;
  unitPrice: string;
  currency: 'CNY';
  itemsAmount: string;
  shippingAmount: string;
  payableAmount: string;
  recipient: PurchaseRecipient;
};

export type PurchaseDraft = {
  id: string;
  conversationId: string;
  productExternalId: string;
  skuId: string | null;
  quantity: number;
  recipient: PurchaseRecipient;
  status: PurchaseDraftStatus;
  version: number;
  confirmation: PurchaseConfirmation | null;
  issues: PurchaseIssue[];
  orderId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  skuOptions?: PurchaseSkuOption[];
  availableSkus?: PurchaseSkuOption[];
};

export type PurchaseOrderRef = OrderDetail | null;

export type PurchaseDraftResponse = {
  draft: PurchaseDraft | null;
  order: PurchaseOrderRef;
};

export type StartPurchasePayload = {
  productExternalId: string;
  expectedVersion: number | null;
};

export type PatchPurchasePayload = {
  expectedVersion: number;
  skuId?: string | null;
  quantity?: number;
  recipient?: Partial<PurchaseRecipient>;
};

export type PurchaseVersionPayload = {
  expectedVersion: number;
};

export type SelectPurchaseAddressPayload = {
  addressId: string;
  expectedVersion: number;
};

export type PurchaseReference = {
  draftId: string;
  version: number;
  orderId: string | null;
};
