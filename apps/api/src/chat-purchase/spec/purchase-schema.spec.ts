import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import {
  patchPurchaseSchema,
  startPurchaseSchema,
  purchaseDraftParamsSchema,
  purchaseVersionSchema,
} from '../dto/chat-purchase.schema.js';
import { ChatPurchaseDraft } from '../entity/chat-purchase-draft.entity.js';
import { PurchaseProjectionService } from '../service/purchase-projection.service.js';

test('购买 schema 拒绝未知字段、数字字符串、空 PATCH，保留省略和 null 语义', async () => {
  for (const input of [
    {},
    { expectedVersion: 1 },
    { expectedVersion: 1, recipient: {} },
    { expectedVersion: 1, recipient: { name: undefined } },
    { expectedVersion: '1', quantity: 1 },
    { expectedVersion: 1, quantity: '1' },
    { expectedVersion: 1, quantity: null },
    { expectedVersion: 1, quantity: 0 },
    { expectedVersion: 1, quantity: 100 },
    { expectedVersion: 1, price: '1.00' },
    { expectedVersion: 1, recipient: { name: '' } },
    { expectedVersion: 1, recipient: { address: 'a\nb' } },
    { expectedVersion: 1, recipient: { phone: '123' } },
    { expectedVersion: 1, recipient: { userId: randomUUID() } },
  ])
    assert.equal(patchPurchaseSchema.safeParse(input).success, false);
  assert.deepEqual(
    patchPurchaseSchema.parse({
      expectedVersion: 1,
      recipient: { name: ' 测试 ', address: null },
      skuId: null,
    }),
    {
      expectedVersion: 1,
      recipient: { name: '测试', address: null },
      skuId: null,
    },
  );
  for (const quantity of [1, 99])
    assert.equal(
      patchPurchaseSchema.parse({ expectedVersion: 1, quantity }).quantity,
      quantity,
    );
  assert.equal(
    startPurchaseSchema.safeParse({ productExternalId: 'x' }).success,
    false,
  );
  assert.equal(
    startPurchaseSchema.parse({
      productExternalId: ' x ',
      expectedVersion: null,
    }).productExternalId,
    'x',
  );
  assert.equal(
    purchaseVersionSchema.safeParse({ expectedVersion: 0 }).success,
    false,
  );
  assert.equal(
    purchaseDraftParamsSchema.safeParse({
      conversationId: 'invalid',
      draftId: randomUUID(),
    }).success,
    false,
  );
  const pipe = new StandardSchemaValidationPipe();
  await assert.rejects(
    pipe.transform({ expectedVersion: 1 }, {
      type: 'body',
      schema: patchPurchaseSchema,
    } as never),
    { status: 400 },
  );
});

test('报价增版但不续期，同报价不增版，有效修改只推进一次且金额精确', () => {
  const projector = new PurchaseProjectionService();
  const draft = Object.assign(new ChatPurchaseDraft(), {
    productExternalId: 'fixture',
    skuId: randomUUID(),
    recipientName: '测试',
    recipientPhone: '13800000000',
    recipientAddress: '测试地址',
    quantity: 3,
  });
  const sku = {
    skuId: draft.skuId!,
    productExternalId: 'fixture',
    productName: '测试服装',
    color: '白色',
    size: 'M',
    unitPrice: '19.99',
    currency: 'CNY' as const,
    imageUrl: null,
    inStock: true,
  };
  const expiry = draft.expiresAt.toISOString();
  projector.refresh(draft, [sku], new Date(), true);
  assert.equal(draft.version, 1);
  assert.equal(draft.confirmation?.payableAmount, '59.97');
  projector.refresh(draft, [sku], new Date());
  assert.equal(draft.version, 1);
  projector.refresh(draft, [{ ...sku, unitPrice: '20.00' }], new Date());
  assert.equal(draft.version, 2);
  assert.equal(draft.confirmation?.version, 2);
  assert.equal(draft.issues[0]?.code, 'price_changed');
  assert.equal(draft.expiresAt.toISOString(), expiry);
  projector.refresh(draft, [{ ...sku, unitPrice: '20.00' }], new Date());
  assert.equal(draft.version, 2);
  projector.refresh(draft, [sku], draft.expiresAt);
  assert.equal(draft.status, 'expired');
  assert.equal(draft.confirmation, null);
});
