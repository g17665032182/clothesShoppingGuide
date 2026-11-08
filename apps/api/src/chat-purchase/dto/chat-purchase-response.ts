export type PurchaseStatus =
  'collecting' | 'ready' | 'submitted' | 'cancelled' | 'expired';
export type PurchaseRecipient = {
  name: string | null;
  phone: string | null;
  address: string | null;
};
export type PurchaseIssue =
  | {
      code: 'missing_field';
      field: 'recipient.name' | 'recipient.phone' | 'recipient.address';
    }
  | {
      code:
        | 'sku_selection_required'
        | 'product_unavailable'
        | 'sku_unavailable'
        | 'insufficient_stock'
        | 'price_changed'
        | 'specification_changed'
        | 'expired';
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
  recipient: { name: string; phone: string; address: string };
};
export type PurchaseDraftResponse = {
  id: string;
  conversationId: string;
  productExternalId: string;
  skuId: string | null;
  quantity: number;
  recipient: PurchaseRecipient;
  status: PurchaseStatus;
  version: number;
  confirmation: PurchaseConfirmation | null;
  issues: PurchaseIssue[];
  orderId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};
export type PurchaseReference = {
  draftId: string;
  version: number;
  orderId: string | null;
};
