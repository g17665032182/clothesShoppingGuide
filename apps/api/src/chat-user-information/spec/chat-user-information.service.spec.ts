import assert from 'node:assert/strict';
import test from 'node:test';

import { OrderStatus } from '../../orders/index.js';
import { getMyInformationSchema } from '../dto/chat-user-information.schema.js';
import { ChatUserInformationService } from '../service/chat-user-information.service.js';

const address = {
  id: 'address-id',
  recipientName: 'Private Name',
  phone: '13800000000',
  address: 'Private Address',
  label: 'Private Label',
  isDefault: true,
  createdAt: '2026-11-12T00:00:00.000Z',
  updatedAt: '2026-11-12T00:00:00.000Z',
};
const order = {
  id: 'order-id',
  orderNo: 'ORD-1',
  status: OrderStatus.PENDING_SHIPMENT,
  closeReason: null,
  itemsAmount: '100.00',
  payableAmount: '100.00',
  itemCount: 1,
  createdAt: '2026-11-12T00:00:00.000Z',
  paidAt: '2026-11-12T01:00:00.000Z',
  shippedAt: null,
  completedAt: null,
  expiresAt: '2026-11-12T02:00:00.000Z',
  closedAt: null,
  currency: 'CNY',
  paymentMode: 'simulated',
  recipient: {
    name: 'Private Recipient',
    phone: '13900000000',
    address: 'Private Shipping Address',
  },
  shipment: { carrier: 'Private Carrier', trackingNo: 'PRIVATE-TRACKING' },
  items: [
    {
      skuId: 'private-sku-id',
      productExternalId: 'private-external-id',
      productName: '外套',
      color: '黑色',
      size: 'M',
      imageUrl: 'https://private.example/image',
      unitPrice: '100.00',
      quantity: 1,
      lineAmount: '100.00',
    },
  ],
};
const photo = {
  photoId: 'photo-id',
  kind: 'person',
  mimeType: 'image/webp',
  byteSize: 1234,
  width: 100,
  height: 200,
  createdAt: '2026-11-12T00:00:00.000Z',
  availability: 'saved',
};

function createService(
  overrides: {
    addresses?: {
      listForUser: (...args: unknown[]) => Promise<unknown>;
    };
    orders?: {
      listForUser: (...args: unknown[]) => Promise<unknown>;
      getForUser: (...args: unknown[]) => Promise<unknown>;
    };
    photos?: {
      listSavedMetadataForUser: (...args: unknown[]) => Promise<unknown>;
    };
  } = {},
) {
  const calls: {
    addresses: unknown[][];
    orders: unknown[][];
    photos: unknown[][];
  } = {
    addresses: [],
    orders: [],
    photos: [],
  };
  const addresses = overrides.addresses ?? {
    listForUser: async (...args: unknown[]) => {
      calls.addresses.push(args);
      return { items: [address], total: 1, page: 1, pageSize: 5 };
    },
  };
  const orders = overrides.orders ?? {
    listForUser: async (...args: unknown[]) => {
      calls.orders.push(args);
      return { items: [{ id: 'order-id' }], total: 1, page: 1, pageSize: 5 };
    },
    getForUser: async (...args: unknown[]) => {
      calls.orders.push(args);
      return order;
    },
  };
  const photos = overrides.photos ?? {
    listSavedMetadataForUser: async (...args: unknown[]) => {
      calls.photos.push(args);
      return { items: [photo], total: 1, page: 1, pageSize: 5 };
    },
  };

  return {
    service: new ChatUserInformationService(
      addresses as never,
      orders as never,
      photos as never,
    ),
    calls,
  };
}

test('信息查询立即白名单投影本人地址、订单和图片数据', async () => {
  const fixture = createService();
  const input = getMyInformationSchema.parse({});

  const result = await fixture.service.lookup('bound-user-id', input);

  assert.deepEqual(result.sections.addresses, {
    items: [
      {
        addressId: 'address-id',
        isDefault: true,
        displayName: '默认地址',
      },
    ],
    page: 1,
    pageSize: 5,
    total: 1,
  });
  assert.deepEqual(result.sections.orders, {
    items: [
      {
        orderNo: 'ORD-1',
        status: OrderStatus.PENDING_SHIPMENT,
        closeReason: null,
        itemsAmount: '100.00',
        payableAmount: '100.00',
        itemCount: 1,
        createdAt: '2026-11-12T00:00:00.000Z',
        paidAt: '2026-11-12T01:00:00.000Z',
        shippedAt: null,
        completedAt: null,
        items: [
          {
            productName: '外套',
            color: '黑色',
            size: 'M',
            quantity: 1,
          },
        ],
      },
    ],
    page: 1,
    pageSize: 5,
    total: 1,
  });
  assert.deepEqual(result.sections.photos, {
    items: [photo],
    page: 1,
    pageSize: 5,
    total: 1,
  });
  const serialized = JSON.stringify(result);
  for (const sensitiveValue of [
    'Private Name',
    '13800000000',
    'Private Address',
    'Private Label',
    'Private Recipient',
    'Private Shipping Address',
    'PRIVATE-TRACKING',
    'private-sku-id',
    'private-external-id',
    'https://private.example/image',
  ]) {
    assert.equal(serialized.includes(sensitiveValue), false);
  }
  assert.deepEqual(fixture.calls.addresses[0], [
    'bound-user-id',
    { page: 1, pageSize: 5 },
  ]);
  assert.deepEqual(fixture.calls.photos[0], ['bound-user-id', 1]);
});

test('单个 section 故障时保留其他成功结果并返回固定错误码', async () => {
  const fixture = createService({
    addresses: {
      listForUser: async () => {
        throw new Error('private database error');
      },
    },
  });

  const result = await fixture.service.lookup(
    'bound-user-id',
    getMyInformationSchema.parse({
      sections: ['addresses', 'photos'],
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.sections.addresses, undefined);
  assert.deepEqual(result.sections.photos?.items, [photo]);
  assert.deepEqual(result.errors, [
    { section: 'addresses', code: 'unavailable' },
  ]);
  assert.equal(
    JSON.stringify(result).includes('private database error'),
    false,
  );
});

test('空地址簿是成功的空结果，不转换为 unavailable', async () => {
  const fixture = createService({
    addresses: {
      listForUser: async () => ({
        items: [],
        total: 0,
        page: 1,
        pageSize: 5,
      }),
    },
  });

  const result = await fixture.service.lookup(
    'bound-user-id',
    getMyInformationSchema.parse({ sections: ['addresses'] }),
  );

  assert.deepEqual(result, {
    ok: true,
    sections: {
      addresses: {
        items: [],
        total: 0,
        page: 1,
        pageSize: 5,
      },
    },
    errors: [],
  });
});
