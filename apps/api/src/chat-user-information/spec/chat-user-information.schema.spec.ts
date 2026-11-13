import assert from 'node:assert/strict';
import test from 'node:test';

import { OrderStatus } from '../../orders/index.js';
import { getMyInformationSchema } from '../dto/chat-user-information.schema.js';

test('信息查询默认包含三类且分页默认第一页', () => {
  assert.deepEqual(getMyInformationSchema.parse({}), {
    sections: ['addresses', 'orders', 'photos'],
    page: 1,
  });
});

test('信息查询支持严格的订单过滤和有界分页', () => {
  assert.deepEqual(
    getMyInformationSchema.parse({
      sections: ['orders'],
      orderNo: '  ORD-1 ',
      status: OrderStatus.PENDING_PAYMENT,
      page: 10,
    }),
    {
      sections: ['orders'],
      orderNo: 'ORD-1',
      status: OrderStatus.PENDING_PAYMENT,
      page: 10,
    },
  );

  for (const input of [
    { unknown: true },
    { sections: [] },
    { sections: ['orders', 'orders'] },
    { sections: ['unknown'] },
    { page: 0 },
    { page: 11 },
    { sections: ['addresses'], status: OrderStatus.PENDING_PAYMENT },
    { sections: ['photos'], orderNo: 'ORD-1' },
    { sections: ['orders'], orderNo: '   ' },
  ]) {
    assert.equal(getMyInformationSchema.safeParse(input).success, false);
  }
});

test('试穿查询显式支持四类 section，状态与订单筛选互相独立', () => {
  for (const tryOnStatus of ['queued', 'processing', 'succeeded', 'failed']) {
    assert.deepEqual(
      getMyInformationSchema.parse({
        sections: ['addresses', 'orders', 'photos', 'try_on_tasks'],
        status: OrderStatus.PENDING_PAYMENT,
        tryOnStatus,
        page: 10,
      }),
      {
        sections: ['addresses', 'orders', 'photos', 'try_on_tasks'],
        status: OrderStatus.PENDING_PAYMENT,
        tryOnStatus,
        page: 10,
      },
    );
  }
});

test('试穿查询拒绝无 section 状态、数字转换、资源身份和动作字段', () => {
  for (const input of [
    { tryOnStatus: 'queued' },
    { sections: ['photos'], tryOnStatus: 'queued' },
    { sections: ['try_on_tasks'], tryOnStatus: 'deleted' },
    { sections: ['try_on_tasks'], status: OrderStatus.PENDING_PAYMENT },
    { sections: ['try_on_tasks'], orderNo: 'ORD-1' },
    { sections: ['try_on_tasks', 'try_on_tasks'] },
    ...['1', 0, 11, 1.5, Number.MAX_SAFE_INTEGER + 1].map((page) => ({
      sections: ['try_on_tasks'],
      page,
    })),
    ...[
      'userId',
      'taskId',
      'photoId',
      'resultId',
      'unread',
      'pageSize',
      'url',
      'action',
    ].map((field) => ({
      sections: ['try_on_tasks'],
      [field]: 'forbidden',
    })),
  ]) {
    assert.equal(getMyInformationSchema.safeParse(input).success, false);
  }
});
