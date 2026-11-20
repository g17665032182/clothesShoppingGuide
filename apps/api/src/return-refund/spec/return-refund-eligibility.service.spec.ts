import assert from 'node:assert/strict';
import test from 'node:test';

import { ReturnRefundManualReviewReason } from '../port/return-refund-eligibility.port.js';
import { ReturnRefundEligibilityService } from '../service/return-refund-eligibility.service.js';

const service = new ReturnRefundEligibilityService();
const completedAt = new Date('2026-11-12T04:00:00.000Z');
const completedOrder = {
  id: '11111111-1111-4111-8111-111111111111',
  orderNo: 'OD-TEST',
  status: 'completed' as const,
  currency: 'CNY',
  completedAt,
  items: [],
};

test('北京时间收货日当天仍可申请退货退款', () => {
  assert.deepEqual(
    service.evaluate(completedOrder, new Date('2026-11-12T15:59:59.999Z')),
    { manualReviewRequired: false, manualReviewReason: null },
  );
});

test('按北京时间自然日计算，不受 UTC 日期变化影响', () => {
  assert.deepEqual(
    service.evaluate(completedOrder, new Date('2026-11-18T15:59:59.999Z')),
    { manualReviewRequired: false, manualReviewReason: null },
  );

  const completionNearBeijingMidnight = {
    ...completedOrder,
    completedAt: new Date('2026-11-12T16:30:00.000Z'),
  };
  assert.deepEqual(
    service.evaluate(
      completionNearBeijingMidnight,
      new Date('2026-11-19T15:59:59.999Z'),
    ),
    { manualReviewRequired: false, manualReviewReason: null },
  );
  assert.deepEqual(
    service.evaluate(
      completionNearBeijingMidnight,
      new Date('2026-11-19T16:00:00.000Z'),
    ),
    {
      manualReviewRequired: true,
      manualReviewReason: ReturnRefundManualReviewReason.OUTSIDE_RETURN_WINDOW,
    },
  );
});

test('第 7 天北京时间 23:59:59.999 仍可申请，之后转人工审核', () => {
  assert.deepEqual(
    service.evaluate(completedOrder, new Date('2026-11-18T15:59:59.998Z')),
    { manualReviewRequired: false, manualReviewReason: null },
  );
  assert.deepEqual(
    service.evaluate(completedOrder, new Date('2026-11-18T15:59:59.999Z')),
    { manualReviewRequired: false, manualReviewReason: null },
  );
  assert.deepEqual(
    service.evaluate(completedOrder, new Date('2026-11-18T16:00:00.000Z')),
    {
      manualReviewRequired: true,
      manualReviewReason: ReturnRefundManualReviewReason.OUTSIDE_RETURN_WINDOW,
    },
  );
  assert.deepEqual(
    service.evaluate(
      { ...completedOrder, status: 'pending_receipt' },
      new Date(completedAt),
    ),
    {
      manualReviewRequired: true,
      manualReviewReason: ReturnRefundManualReviewReason.ORDER_NOT_COMPLETED,
    },
  );
  assert.deepEqual(
    service.evaluate(
      { ...completedOrder, completedAt: null },
      new Date(completedAt),
    ),
    {
      manualReviewRequired: true,
      manualReviewReason:
        ReturnRefundManualReviewReason.COMPLETION_TIME_MISSING,
    },
  );
  assert.deepEqual(
    service.evaluate(
      { ...completedOrder, completedAt: new Date('invalid') },
      new Date(completedAt),
    ),
    {
      manualReviewRequired: true,
      manualReviewReason:
        ReturnRefundManualReviewReason.COMPLETION_TIME_MISSING,
    },
  );
});

test('服务端时间无法判定时转人工审核', () => {
  assert.deepEqual(service.evaluate(completedOrder, new Date('invalid')), {
    manualReviewRequired: true,
    manualReviewReason: ReturnRefundManualReviewReason.OUTSIDE_RETURN_WINDOW,
  });
});
