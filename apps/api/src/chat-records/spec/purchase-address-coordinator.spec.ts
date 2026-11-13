import assert from 'node:assert/strict';
import test from 'node:test';

import { getMyInformationSchema } from '../../chat-user-information/index.js';
import { PurchaseAddressCoordinator } from '../tools/purchase-address-coordinator.js';

function createCoordinator(
  options: {
    message?: string;
    addressTotal?: number;
    addressError?: boolean;
    recipient?: {
      name: string | null;
      phone: string | null;
      address: string | null;
    };
  } = {},
) {
  let addressLookups = 0;
  const staged: Array<{ draftId: string; draftVersion: number }> = [];
  const information = {
    lookup: async (_userId: string, input: { sections: string[] }) => {
      if (input.sections.includes('addresses')) {
        addressLookups += 1;
        return {
          ok: true as const,
          sections: options.addressError
            ? {}
            : {
                addresses: {
                  items: options.addressTotal
                    ? [
                        {
                          addressId: '11111111-1111-4111-8111-111111111111',
                          isDefault: true,
                          displayName: '默认地址',
                        },
                      ]
                    : [],
                  total: options.addressTotal ?? 0,
                  page: 1,
                  pageSize: 5 as const,
                },
              },
          errors: options.addressError
            ? [{ section: 'addresses' as const, code: 'unavailable' as const }]
            : [],
        };
      }
      return { ok: true as const, sections: {}, errors: [] };
    },
  };
  const drafts = {
    dynamicFormState: async () => ({
      draft: {
        id: '22222222-2222-4222-8222-222222222222',
        version: 4,
        recipient: options.recipient ?? {
          name: null,
          phone: null,
          address: null,
        },
      },
      skus: [],
    }),
  };
  const coordinator = new PurchaseAddressCoordinator(
    information as never,
    drafts as never,
    'user',
    'conversation',
    true,
    options.message ?? '购买',
    (draftId, draftVersion) => staged.push({ draftId, draftVersion }),
  );
  return {
    coordinator,
    staged,
    get addressLookups() {
      return addressLookups;
    },
  };
}

test('同轮信息查询和表单 gate 共用地址查询并只 stage 一张安全卡片', async () => {
  const fixture = createCoordinator({ addressTotal: 1 });
  const [response, preflight] = await Promise.all([
    fixture.coordinator.lookup(
      getMyInformationSchema.parse({ sections: ['addresses'] }),
    ),
    fixture.coordinator.preflightDynamicForm({
      fields: [{ key: 'recipient.address' }],
    }),
  ]);

  assert.equal(response.sections.addresses?.total, 1);
  assert.deepEqual(preflight, {
    ok: false,
    code: 'address_selection_required',
  });
  assert.equal(fixture.addressLookups, 1);
  assert.deepEqual(fixture.staged, [
    {
      draftId: '22222222-2222-4222-8222-222222222222',
      draftVersion: 4,
    },
  ]);
});

test('空地址簿允许动态表单，查询失败不伪装为空地址簿', async () => {
  const empty = createCoordinator({ addressTotal: 0 });
  assert.equal(
    await empty.coordinator.preflightDynamicForm({
      fields: [{ key: 'recipient.address' }],
    }),
    null,
  );
  assert.equal(empty.staged.length, 0);

  const unavailable = createCoordinator({ addressError: true });
  assert.deepEqual(
    await unavailable.coordinator.preflightDynamicForm({
      fields: [{ key: 'recipient.address' }],
    }),
    {
      ok: false,
      code: 'information_unavailable',
    },
  );
  assert.equal(unavailable.staged.length, 0);
});

test('只请求 SKU 或数量时不触发地址簿 gate', async () => {
  const fixture = createCoordinator({ addressTotal: 1 });

  assert.equal(
    await fixture.coordinator.preflightDynamicForm({
      fields: [{ key: 'skuId' }, { key: 'quantity' }],
    }),
    null,
  );
  assert.equal(fixture.addressLookups, 0);
  assert.equal(fixture.staged.length, 0);
});

test('用户明确要求手动填写时不与并行信息查询产生地址卡冲突', async () => {
  const fixture = createCoordinator({
    addressTotal: 1,
    message: '不用选地址，我想手动填写',
  });
  const [response, preflight] = await Promise.all([
    fixture.coordinator.lookup(
      getMyInformationSchema.parse({ sections: ['addresses'] }),
    ),
    fixture.coordinator.preflightDynamicForm({
      fields: [{ key: 'recipient.address' }],
    }),
  ]);

  assert.equal(response.sections.addresses?.total, 1);
  assert.equal(preflight, null);
  assert.equal(fixture.staged.length, 0);
});

test('试穿筛选独立转发，不读地址或草稿；混合查询仍只为地址生成卡片', async () => {
  const received: unknown[] = [];
  let draftReads = 0;
  const staged: unknown[] = [];
  const coordinator = new PurchaseAddressCoordinator(
    {
      lookup: async (userId: string, input: { sections: string[] }) => {
        assert.equal(userId, 'authenticated-user');
        received.push(input);
        return input.sections.includes('addresses')
          ? {
              ok: true,
              sections: {
                addresses: { items: [], total: 1, page: 1, pageSize: 5 },
              },
              errors: [],
            }
          : {
              ok: true,
              sections: {
                try_on_tasks: { items: [], total: 0, page: 2, pageSize: 5 },
              },
              errors: [],
            };
      },
    } as never,
    {
      dynamicFormState: async () => {
        draftReads += 1;
        return { draft: { id: 'draft', version: 1, recipient: {} } };
      },
    } as never,
    'authenticated-user',
    'conversation',
    true,
    '查询试穿',
    (...reference) => staged.push(reference),
  );
  const input = getMyInformationSchema.parse({
    sections: ['try_on_tasks'],
    tryOnStatus: 'processing',
    page: 2,
  });
  const response = await coordinator.lookup(input);
  assert.equal(response.sections.try_on_tasks?.total, 0);
  assert.deepEqual(received, [input]);
  assert.equal(draftReads, 0);
  assert.deepEqual(staged, []);
  await coordinator.lookup({
    ...input,
    sections: ['addresses', 'try_on_tasks'],
  });
  assert.equal(draftReads, 1);
  assert.deepEqual(staged, [['draft', 1]]);
  assert.deepEqual(received.slice(1), [
    { sections: ['addresses'], page: 2 },
    input,
  ]);
});
