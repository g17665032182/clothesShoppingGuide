import assert from 'node:assert/strict';
import test from 'node:test';

import type { DynamicFormContext } from '../port/dynamic-form-handler.port.js';
import type { DynamicFormRequestInput } from '../dto/chat-dynamic-form.schema.js';
import type { PurchaseDynamicFormState } from '../../chat-purchase/service/purchase-draft.service.js';
import { PurchaseRecipientFormAdapter } from '../adapter/purchase-recipient-form.adapter.js';

function createAdapter(state: PurchaseDynamicFormState) {
  return new PurchaseRecipientFormAdapter({
    dynamicFormState: async () => state,
  } as never);
}

const context: DynamicFormContext = {
  userId: '00000000-0000-4000-8000-000000000001',
  conversationId: '00000000-0000-4000-8000-000000000002',
  runId: 'purchase-recipient-test',
};

const request: DynamicFormRequestInput = {
  formKind: 'purchase_recipient',
  title: '补充收货信息',
  fields: [
    {
      key: 'recipient.name',
      label: '收件人',
      type: 'text',
      required: true,
    },
    {
      key: 'recipient.phone',
      label: '手机号',
      type: 'tel',
      required: true,
    },
    {
      key: 'recipient.address',
      label: '收货地址',
      type: 'textarea',
      required: true,
    },
    {
      key: 'quantity',
      label: '数量',
      type: 'number',
      required: true,
    },
  ],
};

function makeState(
  recipient: PurchaseDynamicFormState['draft']['recipient'],
): PurchaseDynamicFormState {
  return {
    draft: {
      id: '00000000-0000-4000-8000-000000000003',
      conversationId: context.conversationId,
      productExternalId: 'test-product',
      skuId: null,
      quantity: 1,
      recipient,
      status: 'collecting',
      version: 3,
      confirmation: null,
      issues: [],
      orderId: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    skus: [],
  };
}

test('购买收件动态表单只保留请求中且草稿缺失的收件字段', async () => {
  const adapter = createAdapter(
    makeState({
      name: '已有收件人',
      phone: null,
      address: '已有地址',
    }),
  );

  const prepared = await adapter.prepareForm(context, request);

  assert.deepEqual(
    prepared.fields.map((field) => field.key),
    ['recipient.phone', 'quantity'],
  );
  assert.equal(prepared.fields[0]?.value, null);
  assert.equal(prepared.fields[1]?.value, 1);
  assert.deepEqual(prepared.handlerContext, {
    draftId: '00000000-0000-4000-8000-000000000003',
    draftVersion: 3,
  });
});

test('草稿已有全部收件信息时不创建重复收集表单', async () => {
  const adapter = createAdapter(
    makeState({
      name: '已有收件人',
      phone: '13800000000',
      address: '已有地址',
    }),
  );

  await assert.rejects(
    adapter.prepareForm(context, {
      ...request,
      fields: request.fields.filter((field) =>
        field.key.startsWith('recipient.'),
      ),
    }),
    /没有待补充的收件字段/u,
  );
});
