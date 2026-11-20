import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import type { EntityManager } from '@mikro-orm/core';
import type { EntityRepository } from '@mikro-orm/postgresql';

import type { OrderReturnRefundReaderPort } from '../../orders/index.js';
import {
  ReturnRefundApplication,
  ReturnRefundStatus,
} from '../entity/return-refund-application.entity.js';
import { ReturnRefundEvent } from '../entity/return-refund-event.entity.js';
import { ReturnRefundItem } from '../entity/return-refund-item.entity.js';
import type { ReturnRefundEligibilityPolicy } from '../port/return-refund-eligibility.port.js';
import { ReturnRefundService } from '../service/return-refund.service.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const adminId = '33333333-3333-4333-8333-333333333333';
const orderId = '44444444-4444-4444-8444-444444444444';
const itemId = '55555555-5555-4555-8555-555555555555';
const secondItemId = '66666666-6666-4666-8666-666666666666';
const applicationId = '77777777-7777-4777-8777-777777777777';
const idempotencyKey = '88888888-8888-4888-8888-888888888888';
const now = new Date('2026-11-19T04:00:00.000Z');

type State = {
  applications: ReturnRefundApplication[];
  items: ReturnRefundItem[];
  events: ReturnRefundEvent[];
};

function cloneState(state: State): State {
  return {
    applications: state.applications.map((row) =>
      Object.assign(new ReturnRefundApplication(), structuredClone(row)),
    ),
    items: state.items.map((row) =>
      Object.assign(new ReturnRefundItem(), structuredClone(row)),
    ),
    events: state.events.map((row) =>
      Object.assign(new ReturnRefundEvent(), structuredClone(row)),
    ),
  };
}

function matches(
  row: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const value = row[key];
    if (
      expected &&
      typeof expected === 'object' &&
      !Array.isArray(expected) &&
      ('$in' in expected || '$nin' in expected)
    ) {
      const filter = expected as { $in?: unknown[]; $nin?: unknown[] };
      if (filter.$in && !filter.$in.includes(value)) return false;
      if (filter.$nin && filter.$nin.includes(value)) return false;
      return true;
    }
    return value === expected;
  });
}

function makeOrderSnapshot() {
  return {
    id: orderId,
    orderNo: 'OD-RETURN-001',
    status: 'completed' as const,
    currency: 'CNY',
    completedAt: new Date('2026-11-12T04:00:00.000Z'),
    items: [
      {
        orderItemId: itemId,
        productName: '羊毛大衣',
        productExternalId: 'coat-1',
        color: '黑色',
        size: 'M',
        imageUrl: null,
        unitPrice: '125.50',
        quantity: 2,
      },
      {
        orderItemId: secondItemId,
        productName: '针织围巾',
        productExternalId: 'scarf-1',
        color: '灰色',
        size: '均码',
        imageUrl: null,
        unitPrice: '20.00',
        quantity: 3,
      },
    ],
  };
}

function makeApplication(
  overrides: Partial<ReturnRefundApplication> = {},
): ReturnRefundApplication {
  return Object.assign(new ReturnRefundApplication(), {
    id: applicationId,
    orderId,
    userId: ownerId,
    orderNo: 'OD-RETURN-001',
    status: ReturnRefundStatus.PENDING_USER_SUBMISSION,
    manualReviewRequired: false,
    manualReviewReason: null,
    reason: '商品不合适',
    rejectionReason: null,
    refundAmount: '251.00',
    currency: 'CNY',
    returnCarrier: null,
    returnTrackingNo: null,
    idempotencyKey,
    requestHash: 'request-hash',
    version: 1,
    submittedAt: null,
    approvedAt: null,
    returnedAt: null,
    receivedAt: null,
    refundProcessingAt: null,
    refundedAt: null,
    rejectedAt: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

function makeItem(overrides: Partial<ReturnRefundItem> = {}): ReturnRefundItem {
  return Object.assign(new ReturnRefundItem(), {
    id: '99999999-9999-4999-8999-999999999999',
    applicationId,
    orderItemId: itemId,
    productExternalId: 'coat-1',
    productName: '羊毛大衣',
    color: '黑色',
    size: 'M',
    imageUrl: null,
    unitPrice: '125.50',
    quantity: 2,
    lineAmount: '251.00',
    ...overrides,
  });
}

function fixture(
  options: {
    owner?: string;
    applications?: ReturnRefundApplication[];
    items?: ReturnRefundItem[];
    eligibilityPolicy?: ReturnRefundEligibilityPolicy;
  } = {},
) {
  let state: State = {
    applications: options.applications ?? [],
    items: options.items ?? [],
    events: [],
  };
  const calls = {
    flush: 0,
    created: 0,
    readers: [] as string[],
    transactions: 0,
    rollbacks: 0,
  };

  function makeEntityManager(transactionState: State) {
    return {
      getTransactionContext: () => transactionState,
      getConnection: () => ({
        async execute<T>(sql: string) {
          if (sql.includes('clock_timestamp'))
            return [{ now: new Date(now) }] as T;
          return [] as T;
        },
      }),
      async findOne<T>(
        entity: new () => T,
        where: Record<string, unknown>,
      ): Promise<T | null> {
        const rows =
          entity === ReturnRefundApplication
            ? transactionState.applications
            : entity === ReturnRefundItem
              ? transactionState.items
              : transactionState.events;
        return (
          (rows.find((row) =>
            matches(row as unknown as Record<string, unknown>, where),
          ) as T | undefined) ?? null
        );
      },
      async find<T>(
        entity: new () => T,
        where: Record<string, unknown>,
      ): Promise<T[]> {
        const rows =
          entity === ReturnRefundApplication
            ? transactionState.applications
            : entity === ReturnRefundItem
              ? transactionState.items
              : transactionState.events;
        return rows.filter((row) =>
          matches(row as unknown as Record<string, unknown>, where),
        ) as T[];
      },
      async findAndCount<T>(
        entity: new () => T,
        where: Record<string, unknown>,
      ): Promise<[T[], number]> {
        const rows =
          entity === ReturnRefundApplication
            ? transactionState.applications
            : entity === ReturnRefundItem
              ? transactionState.items
              : transactionState.events;
        const filtered = rows.filter((row) =>
          matches(row as unknown as Record<string, unknown>, where),
        ) as T[];
        return [filtered, filtered.length];
      },
      async count<T>(
        entity: new () => T,
        where: Record<string, unknown>,
      ): Promise<number> {
        const rows =
          entity === ReturnRefundApplication
            ? transactionState.applications
            : entity === ReturnRefundItem
              ? transactionState.items
              : transactionState.events;
        return rows.filter((row) =>
          matches(row as unknown as Record<string, unknown>, where),
        ).length;
      },
      create<T>(entity: new () => T, data: Record<string, unknown>): T {
        const value = Object.assign(new entity() as object, data);
        calls.created += 1;
        if (value instanceof ReturnRefundApplication)
          transactionState.applications.push(value);
        else if (value instanceof ReturnRefundItem)
          transactionState.items.push(value);
        else if (value instanceof ReturnRefundEvent)
          transactionState.events.push(value);
        return value as T;
      },
      persist() {},
      async flush() {
        calls.flush += 1;
      },
      async transactional<T>(
        callback: (transaction: EntityManager) => Promise<T>,
      ): Promise<T> {
        calls.transactions += 1;
        const workingState = cloneState(state);
        try {
          const result = await callback(
            makeEntityManager(workingState) as unknown as EntityManager,
          );
          state = workingState;
          return result;
        } catch (error) {
          calls.rollbacks += 1;
          throw error;
        }
      },
    };
  }

  const manager = {
    fork() {
      return makeEntityManager(state);
    },
  };
  const applicationRepository = {
    getEntityManager: () => manager,
    async findOne(where: Record<string, unknown>) {
      return (
        state.applications.find((row) =>
          matches(row as unknown as Record<string, unknown>, where),
        ) ?? null
      );
    },
    async findAndCount(where: Record<string, unknown>) {
      const rows = state.applications.filter((row) =>
        matches(row as unknown as Record<string, unknown>, where),
      );
      return [rows, rows.length] as const;
    },
    async count(where: Record<string, unknown>) {
      return state.applications.filter((row) =>
        matches(row as unknown as Record<string, unknown>, where),
      ).length;
    },
  };
  const itemRepository = {
    async find(where: Record<string, unknown>) {
      return state.items.filter((row) =>
        matches(row as unknown as Record<string, unknown>, where),
      );
    },
  };
  const order = makeOrderSnapshot();
  const reader: OrderReturnRefundReaderPort = {
    async listReturnRefundOrdersForUser(userId) {
      calls.readers.push(userId);
      return [];
    },
    async getReturnRefundOrderForUser(userId, requestedOrderId) {
      calls.readers.push(userId);
      return userId === (options.owner ?? ownerId) &&
        requestedOrderId === orderId
        ? order
        : null;
    },
    async getReturnRefundOrderInTransaction(_em, userId, requestedOrderId) {
      calls.readers.push(userId);
      return userId === (options.owner ?? ownerId) &&
        requestedOrderId === orderId
        ? order
        : null;
    },
  };
  const service = new ReturnRefundService(
    applicationRepository as unknown as EntityRepository<ReturnRefundApplication>,
    itemRepository as unknown as EntityRepository<ReturnRefundItem>,
    reader,
    options.eligibilityPolicy,
  );

  return {
    service,
    calls,
    get state() {
      return state;
    },
  };
}

test('本人隔离：聊天草稿订单不属于当前用户时返回 404 且不写入', async () => {
  const subject = fixture({ owner: otherUserId });

  await assert.rejects(
    subject.service.createDraftFromChat(
      ownerId,
      {
        orderId,
        items: [{ orderItemId: itemId, quantity: 1 }],
        reason: '尺码不合适',
      },
      idempotencyKey,
    ),
    (error: unknown) =>
      error instanceof NotFoundException && error.getStatus() === 404,
  );

  assert.deepEqual(subject.state.applications, []);
  assert.deepEqual(subject.state.items, []);
  assert.deepEqual(subject.calls.readers, [ownerId]);
  assert.equal(subject.calls.rollbacks, 1);
});

test('聊天草稿按订单快照数量与单价计算金额，并按用户和键幂等', async () => {
  const subject = fixture();
  const input = {
    orderId,
    items: [
      { orderItemId: secondItemId, quantity: 1 },
      { orderItemId: itemId, quantity: 2 },
    ],
    reason: '尺码与预期不符',
  };

  const first = await subject.service.createDraftFromChat(
    ownerId,
    input,
    idempotencyKey,
  );
  const replay = await subject.service.createDraftFromChat(
    ownerId,
    {
      ...input,
      items: [...input.items].reverse(),
    },
    idempotencyKey,
  );

  assert.equal(first.applicationId, replay.applicationId);
  assert.equal(first.status, ReturnRefundStatus.PENDING_USER_SUBMISSION);
  assert.equal(first.refundAmount, '271.00');
  assert.equal(subject.state.applications.length, 1);
  assert.equal(subject.state.items.length, 2);
  assert.equal(subject.state.events.length, 1);
  assert.deepEqual(
    subject.state.items.map((line) => [
      line.unitPrice,
      line.quantity,
      line.lineAmount,
    ]),
    [
      ['125.50', 2, '251.00'],
      ['20.00', 1, '20.00'],
    ],
  );
  assert.equal('reason' in first, false);
  assert.equal('userId' in first, false);
});

test('无资格策略时订单页直接提交 fail closed，并回滚全部写入', async () => {
  const subject = fixture();

  await assert.rejects(
    subject.service.createAndSubmitForUser(
      ownerId,
      orderId,
      {
        items: [{ orderItemId: itemId, quantity: 1 }],
        reason: '商品不合适',
      },
      idempotencyKey,
    ),
    (error: unknown) =>
      error instanceof ServiceUnavailableException && error.getStatus() === 503,
  );

  assert.deepEqual(subject.state.applications, []);
  assert.deepEqual(subject.state.items, []);
  assert.deepEqual(subject.state.events, []);
  assert.equal(subject.calls.flush, 0);
  assert.equal(subject.calls.rollbacks, 1);
});

test('同一订单存在活动申请时拒绝新建，终态申请不占用活动唯一位', async () => {
  const activeSubject = fixture({
    applications: [makeApplication()],
  });

  await assert.rejects(
    activeSubject.service.createDraftFromChat(
      ownerId,
      {
        orderId,
        items: [{ orderItemId: itemId, quantity: 1 }],
        reason: '原因',
      },
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ),
    (error: unknown) =>
      error instanceof ConflictException && error.getStatus() === 409,
  );
  assert.equal(activeSubject.state.applications.length, 1);

  const terminalSubject = fixture({
    applications: [makeApplication({ status: ReturnRefundStatus.REJECTED })],
  });
  const created = await terminalSubject.service.createDraftFromChat(
    ownerId,
    { orderId, items: [{ orderItemId: itemId, quantity: 1 }], reason: '原因' },
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  );
  assert.equal(created.status, ReturnRefundStatus.PENDING_USER_SUBMISSION);
  assert.equal(terminalSubject.state.applications.length, 2);
});

test('申请上限按累计已退款数量计算，不能重复申请已退款商品', async () => {
  const refunded = makeApplication({
    status: ReturnRefundStatus.REFUNDED,
    idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    refundAmount: '251.00',
  });
  const subject = fixture({
    applications: [refunded],
    items: [makeItem({ applicationId: refunded.id, quantity: 2 })],
  });

  await assert.rejects(
    subject.service.createDraftFromChat(
      ownerId,
      {
        orderId,
        items: [{ orderItemId: itemId, quantity: 1 }],
        reason: '原因',
      },
      idempotencyKey,
    ),
    (error: unknown) =>
      error instanceof ConflictException && error.getStatus() === 409,
  );
  assert.equal(subject.state.applications.length, 1);
  assert.equal(subject.state.items.length, 1);
});

test('状态动作检查版本并记录管理员拒绝原因，跨用户详情不泄露', async () => {
  const pendingReview = makeApplication({
    status: ReturnRefundStatus.PENDING_REVIEW,
    submittedAt: now,
  });
  const subject = fixture({
    applications: [pendingReview],
    items: [makeItem()],
  });

  await assert.rejects(
    subject.service.rejectForAdmin(adminId, applicationId, {
      version: 2,
      reason: '信息不足',
    }),
    (error: unknown) =>
      error instanceof ConflictException && error.getStatus() === 409,
  );
  assert.equal(
    subject.state.applications[0]?.status,
    ReturnRefundStatus.PENDING_REVIEW,
  );
  assert.equal(subject.state.events.length, 0);

  const rejected = await subject.service.rejectForAdmin(
    adminId,
    applicationId,
    {
      version: 1,
      reason: '缺少必要信息',
    },
  );
  assert.equal(rejected.status, ReturnRefundStatus.REJECTED);
  assert.equal(rejected.rejectionReason, '缺少必要信息');
  assert.equal(rejected.events.at(-1)?.actorRole, 'admin');

  await assert.rejects(
    subject.service.getForUser(otherUserId, applicationId),
    (error: unknown) =>
      error instanceof NotFoundException && error.getStatus() === 404,
  );
});
