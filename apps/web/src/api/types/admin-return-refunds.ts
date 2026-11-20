import type {
  ReturnRefundApplication,
  ReturnRefundStatus,
} from './return-refund';

export type AdminReturnRefundQuery = {
  page: number;
  pageSize: number;
  status?: ReturnRefundStatus;
  manualReviewRequired?: boolean;
  orderNo?: string;
};

export type AdminReturnRefundApplication = ReturnRefundApplication & {
  userId: string;
  events: Array<{
    action: string;
    fromStatus: ReturnRefundStatus | null;
    toStatus: ReturnRefundStatus;
    actorRole: string;
    createdAt: string;
  }>;
};

export type AdminReturnRefundApplicationSummary = {
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

export type AdminReturnRefundApplicationPage = {
  items: AdminReturnRefundApplicationSummary[];
  total: number;
  page: number;
  pageSize: number;
};

export type ReturnRefundActionPayload = {
  version: number;
};

export type RejectReturnRefundPayload = ReturnRefundActionPayload & {
  reason: string;
};
