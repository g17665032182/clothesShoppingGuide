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
const tryOnTask = {
  taskId: '11111111-1111-4111-8111-111111111111',
  status: 'succeeded',
  product: {
    externalId: 'example-product',
    name: '示例外套',
    category: 'outerwear',
    color: '黑色',
  },
  createdAt: '2026-11-13T00:00:00.000Z',
  completedAt: '2026-11-13T00:01:00.000Z',
  resultAvailable: true,
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
    tryOnTasks?: {
      listMetadataForUser: (...args: unknown[]) => Promise<unknown>;
    };
  } = {},
) {
  const calls: {
    addresses: unknown[][];
    orders: unknown[][];
    photos: unknown[][];
    tryOnTasks: unknown[][];
  } = {
    addresses: [],
    orders: [],
    photos: [],
    tryOnTasks: [],
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
  const tryOnTasks = overrides.tryOnTasks ?? {
    listMetadataForUser: async (...args: unknown[]) => {
      calls.tryOnTasks.push(args);
      return { items: [tryOnTask], total: 1, page: 1, pageSize: 5 };
    },
  };

  return {
    service: new ChatUserInformationService(
      addresses as never,
      orders as never,
      photos as never,
      tryOnTasks as never,
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
  assert.deepEqual(fixture.calls.tryOnTasks, []);
});

test('试穿任务显式查询绑定本人并二次投影，不读取其他 section', async () => {
  const calls: unknown[][] = [];
  const fixture = createService({
    tryOnTasks: {
      listMetadataForUser: async (...args: unknown[]) => {
        calls.push(args);
        return {
          items: [
            {
              ...tryOnTask,
              photoId: 'private-photo',
              resultId: 'private-result',
              imageUrl: 'https://private.example/image',
              objectKey: 'private/object',
              providerResponse: 'private-provider',
              product: {
                ...tryOnTask.product,
                imageUrl: 'https://private.example/product',
              },
            },
          ],
          total: 8,
          page: 2,
          pageSize: 5,
          privateField: 'private-page',
        };
      },
    },
  });
  const result = await fixture.service.lookup(
    'bound-user-id',
    getMyInformationSchema.parse({
      sections: ['try_on_tasks'],
      tryOnStatus: 'succeeded',
      page: 2,
    }),
  );
  assert.deepEqual(calls, [
    ['bound-user-id', { page: 2, status: 'succeeded' }],
  ]);
  assert.deepEqual(result, {
    ok: true,
    sections: {
      try_on_tasks: { items: [tryOnTask], page: 2, pageSize: 5, total: 8 },
    },
    errors: [],
  });
  assert.deepEqual(fixture.calls.addresses, []);
  assert.deepEqual(fixture.calls.orders, []);
  assert.deepEqual(fixture.calls.photos, []);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('试穿空页正常成功，故障和损坏投影分别返回固定 unavailable', async () => {
  const empty = createService({
    tryOnTasks: {
      listMetadataForUser: async () => ({
        items: [],
        total: 0,
        page: 1,
        pageSize: 5,
      }),
    },
  });
  assert.deepEqual(
    await empty.service.lookup(
      'bound-user-id',
      getMyInformationSchema.parse({ sections: ['try_on_tasks'] }),
    ),
    {
      ok: true,
      sections: { try_on_tasks: { items: [], total: 0, page: 1, pageSize: 5 } },
      errors: [],
    },
  );
  for (const read of [
    async () => {
      throw new Error('private database error');
    },
    async () => ({
      items: [
        {
          ...tryOnTask,
          product: { ...tryOnTask.product, name: 'private\u0000invalid' },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 5,
    }),
  ]) {
    const fixture = createService({
      tryOnTasks: { listMetadataForUser: read },
    });
    const result = await fixture.service.lookup(
      'bound-user-id',
      getMyInformationSchema.parse({ sections: ['try_on_tasks', 'photos'] }),
    );
    assert.deepEqual(result.errors, [
      { section: 'try_on_tasks', code: 'unavailable' },
    ]);
    assert.equal(result.sections.try_on_tasks, undefined);
    assert.deepEqual(result.sections.photos?.items, [photo]);
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
});

test('所有 section 故障仍保持既有 ok 外层并分别返回错误', async () => {
  const fail = async () => {
    throw new Error('private failure');
  };
  const fixture = createService({
    addresses: { listForUser: fail },
    orders: { listForUser: fail, getForUser: fail },
    photos: { listSavedMetadataForUser: fail },
    tryOnTasks: { listMetadataForUser: fail },
  });
  const sections = ['addresses', 'orders', 'photos', 'try_on_tasks'];
  const result = await fixture.service.lookup(
    'bound-user-id',
    getMyInformationSchema.parse({ sections }),
  );
  assert.deepEqual(result, {
    ok: true,
    sections: {},
    errors: sections.map((section) => ({ section, code: 'unavailable' })),
  });
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
