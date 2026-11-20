import { Injectable } from '@nestjs/common';
import { addDays, startOfDay } from 'date-fns';
import { TZDateMini } from '@date-fns/tz';

import type { ReturnRefundOrderSnapshot } from '../../orders/index.js';
import {
  ReturnRefundManualReviewReason,
  type ReturnRefundEligibility,
  type ReturnRefundEligibilityPolicy,
} from '../port/return-refund-eligibility.port.js';

const BEIJING_TIME_ZONE = 'Asia/Shanghai';

@Injectable()
export class ReturnRefundEligibilityService implements ReturnRefundEligibilityPolicy {
  public evaluate(
    order: ReturnRefundOrderSnapshot,
    now: Date,
  ): ReturnRefundEligibility {
    if (order.status !== 'completed') {
      return {
        manualReviewRequired: true,
        manualReviewReason: ReturnRefundManualReviewReason.ORDER_NOT_COMPLETED,
      };
    }
    if (!order.completedAt || !Number.isFinite(order.completedAt.getTime())) {
      return {
        manualReviewRequired: true,
        manualReviewReason:
          ReturnRefundManualReviewReason.COMPLETION_TIME_MISSING,
      };
    }

    if (!Number.isFinite(now.getTime())) {
      return {
        manualReviewRequired: true,
        manualReviewReason:
          ReturnRefundManualReviewReason.OUTSIDE_RETURN_WINDOW,
      };
    }

    const completedAtInBeijing = new TZDateMini(
      order.completedAt,
      BEIJING_TIME_ZONE,
    );
    // 第八天北京时间零点是第七个自然日的截止边界，不包含该瞬间。
    const returnWindowEnd = addDays(startOfDay(completedAtInBeijing), 7);
    if (now.getTime() >= returnWindowEnd.getTime()) {
      return {
        manualReviewRequired: true,
        manualReviewReason:
          ReturnRefundManualReviewReason.OUTSIDE_RETURN_WINDOW,
      };
    }

    return {
      manualReviewRequired: false,
      manualReviewReason: null,
    };
  }
}
