export type OrderStatus =
  | 'pending_payment'
  | 'pending_shipment'
  | 'pending_receipt'
  | 'completed'
  | 'closed';

export type OrderCloseReason =
  'user_cancelled' | 'payment_expired' | 'product_unavailable' | null;

export type OrderQuery = {
  page: number;
  pageSize: number;
  status?: OrderStatus;
  orderNo?: string;
};

export type OrderSummary = {
  id: string;
  orderNo: string;
  status: OrderStatus;
  closeReason: OrderCloseReason;
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

export type OrderPage = {
  items: OrderSummary[];
  total: number;
  page: number;
  pageSize: number;
};

export type OrderItem = {
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

export type OrderRecipient = {
  name: string;
  phone: string;
  address: string;
};

export type OrderShipment = {
  carrier: string;
  trackingNo: string;
};

export type OrderDetail = OrderSummary & {
  items: OrderItem[];
  recipient: OrderRecipient;
  shipment: OrderShipment | null;
};
