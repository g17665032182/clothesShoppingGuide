export type ReturnRefundStatus =
  | 'pending_user_submission'
  | 'pending_review'
  | 'approved_pending_return'
  | 'returned_by_user'
  | 'pending_inspection'
  | 'refund_processing'
  | 'refunded'
  | 'rejected'
  | 'cancelled';

export type ReturnRefundOrderOptionItem = {
  orderItemId: string;
  productName: string;
  productExternalId: string;
  color: string;
  size: string;
  imageUrl: string | null;
  quantity: number;
  availableQuantity: number;
  unitPrice: string;
};

export type ReturnRefundOrderOptions = {
  orderId: string;
  orderNo: string;
  status: string;
  completedAt: string | null;
  currency: string;
  items: ReturnRefundOrderOptionItem[];
};

export type ReturnRefundApplicationItem = {
  orderItemId: string;
  productName: string;
  productExternalId: string;
  color: string;
  size: string;
  quantity: number;
  unitPrice: string;
  lineAmount: string;
};

export type ReturnRefundEvidence = {
  id: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4';
  byteSize: number;
  createdAt: string;
};

export type ReturnRefundApplication = {
  id: string;
  orderId: string;
  orderNo: string;
  status: ReturnRefundStatus;
  reason: string;
  manualReviewRequired: boolean;
  manualReviewReason: string | null;
  rejectionReason: string | null;
  refundAmount: string;
  currency: string;
  items: ReturnRefundApplicationItem[];
  evidence: ReturnRefundEvidence[];
  returnCarrier: string | null;
  returnTrackingNo: string | null;
  version: number;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  returnedAt: string | null;
  receivedAt: string | null;
  refundProcessingAt: string | null;
  refundedAt: string | null;
  updatedAt: string;
};

export type ReturnRefundApplicationSummary = {
  id: string;
  orderNo: string;
  status: ReturnRefundStatus;
  manualReviewRequired: boolean;
  refundAmount: string;
  currency: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ReturnRefundApplicationPage = {
  items: ReturnRefundApplicationSummary[];
  total: number;
  page: number;
  pageSize: number;
};

export type ReturnRefundApplicationQuery = {
  page: number;
  pageSize: number;
  status?: ReturnRefundStatus;
};

export type ReturnRefundItemRequest = {
  orderItemId: string;
  quantity: number;
};

export type CreateReturnRefundApplicationPayload = {
  items: ReturnRefundItemRequest[];
  reason: string;
  idempotencyKey: string;
};

export type ReturnRefundShipmentPayload = {
  carrier: string;
  trackingNo: string;
  version: number;
};
