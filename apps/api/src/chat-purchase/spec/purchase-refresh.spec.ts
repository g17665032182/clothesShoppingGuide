import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PurchaseDraftService } from '../service/purchase-draft.service.js';
import { PurchaseProjectionService } from '../service/purchase-projection.service.js';
import { ChatPurchaseDraft } from '../entity/chat-purchase-draft.entity.js';

test('草稿等待 SKU 锁后重新读取报价或下架状态，不沿用锁前快照', async () => {
  const now = new Date('2026-11-08T00:00:00.000Z');
  const sku = {
    skuId: 'sku',
    productExternalId: 'product',
    productName: '测试衬衫',
    color: '白色',
    size: 'M',
    unitPrice: '10.00',
    currency: 'CNY' as const,
    imageUrl: null,
    inStock: true,
  };
  for (const unavailable of [false, true]) {
    const draft = Object.assign(new ChatPurchaseDraft(), {
      productExternalId: 'product',
      skuId: 'sku',
      recipientName: '测试收件人',
      recipientPhone: '13800000000',
      recipientAddress: '测试地址',
      expiresAt: new Date(now.getTime() + 86_400_000),
    });
    const projection = new PurchaseProjectionService();
    projection.refresh(draft, [sku], now, true);
    let reads = 0;
    let locked = false;
    const drafts = new PurchaseDraftService(
      {} as never,
      {} as never,
      {
        getPurchaseSpecifications: async () => {
          reads += 1;
          if (reads > 1) {
            assert.equal(locked, true);
            if (unavailable) return null;
          }
          return {
            productExternalId: 'product',
            productName: '测试衬衫',
            skus: [{ ...sku, unitPrice: reads > 1 ? '20.00' : '10.00' }],
          };
        },
      },
      {
        lockSkus: async () => {
          locked = true;
          return [{ isSkuActive: true, isProductActive: true, stock: 10 }];
        },
        getReservedQuantities: async () => new Map(),
      } as never,
      projection,
      {} as never,
    );
    drafts.now = async () => now;
    await drafts.refresh({ flush: async () => undefined } as never, draft);
    assert.equal(reads, 2);
    assert.equal(draft.status, unavailable ? 'collecting' : 'ready');
    assert.equal(
      draft.confirmation?.unitPrice,
      unavailable ? undefined : '20.00',
    );
    assert.ok(
      draft.issues.some(
        (issue) =>
          issue.code ===
          (unavailable ? 'product_unavailable' : 'price_changed'),
      ),
    );
  }
});
