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
