export type AdminOrderStatus =
  | 'pending_payment'
  | 'pending_shipment'
  | 'pending_receipt'
  | 'completed'
  | 'closed';

export type AdminOrderQuery = {
  page: number;
  pageSize: number;
  status?: AdminOrderStatus;
  orderNo?: string;
  userId?: string;
};

export type AdminOrderSummary = {
  id: string;
  orderNo: string;
  userId: string;
  status: AdminOrderStatus;
  closeReason: string | null;
  itemsAmount: string;
  shippingAmount: string;
  discountAmount: string;
  payableAmount: string;
  currency: 'CNY';
  paymentMode: 'simulated';
  itemCount: number;
  expiresAt: string;
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
};

export type AdminOrderPage = {
  items: AdminOrderSummary[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminOrderItem = {
  skuId: string;
  productExternalId: string;
  productName: string;
  color: string;
  size: string;
  imageUrl: string | null;
  unitPrice: string;
  quantity: number;
  lineAmount: string;
};

export type AdminOrderDetail = AdminOrderSummary & {
  items: AdminOrderItem[];
  recipient: {
    name: string;
    phone: string;
    address: string;
  };
  shipment: {
    carrier: string;
    trackingNo: string;
  } | null;
};

export type ShipOrderPayload = {
  carrier: string;
  trackingNo: string;
};
