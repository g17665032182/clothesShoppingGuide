import type { ReturnRefundOrderSnapshot } from '../../orders/index.js';

export const RETURN_REFUND_ELIGIBILITY_POLICY = Symbol(
  'RETURN_REFUND_ELIGIBILITY_POLICY',
);

export enum ReturnRefundManualReviewReason {
  ORDER_NOT_COMPLETED = 'order_not_completed',
  COMPLETION_TIME_MISSING = 'completion_time_missing',
  OUTSIDE_RETURN_WINDOW = 'outside_return_window',
}

export type ReturnRefundEligibility = {
  manualReviewRequired: boolean;
  manualReviewReason: ReturnRefundManualReviewReason | null;
};

export interface ReturnRefundEligibilityPolicy {
  evaluate(
    order: ReturnRefundOrderSnapshot,
    now: Date,
  ): ReturnRefundEligibility;
}
