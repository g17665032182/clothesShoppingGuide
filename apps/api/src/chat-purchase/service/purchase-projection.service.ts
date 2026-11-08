import { Injectable } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import type { ChatPurchaseDraft } from '../entity/chat-purchase-draft.entity.js';
import type {
  PurchaseDraftResponse,
  PurchaseIssue,
} from '../dto/chat-purchase-response.js';

export type PurchaseSku = {
  skuId: string;
  productExternalId: string;
  productName: string;
  color: string;
  size: string;
  unitPrice: string;
  currency: 'CNY';
  imageUrl: string | null;
  inStock: boolean;
  canFulfillQuantity?: boolean;
};

export function purchaseAmount(unitPrice: string, quantity: number): string {
  const [whole, fraction = ''] = unitPrice.split('.');
  const minor =
    (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))) *
    BigInt(quantity);
  return `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`;
}

/** 报价只产生公开问题与确认白名单，精确库存不进入草稿。 */
@Injectable()
export class PurchaseProjectionService {
  public refresh(
    draft: ChatPurchaseDraft,
    options: PurchaseSku[] | null,
    now: Date,
    userChanged = false,
  ): void {
    if (!['collecting', 'ready'].includes(draft.status)) return;
    const before = {
      status: draft.status,
      confirmation: draft.confirmation,
      issues: draft.issues,
    };
    const previous = draft.confirmation;
    const issues: PurchaseIssue[] = [];
    if (now >= draft.expiresAt) {
      draft.status = 'expired';
      draft.confirmation = null;
      draft.issues = [{ code: 'expired' }];
    } else {
      const selected = options?.find((option) => option.skuId === draft.skuId);
      if (options === null) issues.push({ code: 'product_unavailable' });
      else if (!draft.skuId) issues.push({ code: 'sku_selection_required' });
      else if (!selected) issues.push({ code: 'sku_unavailable' });
      else if (!selected.inStock || selected.canFulfillQuantity === false)
        issues.push({ code: 'insufficient_stock' });
      for (const [field, value] of [
        ['recipient.name', draft.recipientName],
        ['recipient.phone', draft.recipientPhone],
        ['recipient.address', draft.recipientAddress],
      ] as const) {
        if (!value) issues.push({ code: 'missing_field', field });
      }
      draft.status = issues.length ? 'collecting' : 'ready';
      draft.confirmation =
        draft.status === 'ready' && selected
          ? {
              version: draft.version,
              productExternalId: draft.productExternalId,
              skuId: selected.skuId,
              name: selected.productName,
              color: selected.color,
              size: selected.size,
              imageUrl: selected.imageUrl,
              quantity: draft.quantity,
              unitPrice: selected.unitPrice,
              currency: 'CNY',
              itemsAmount: purchaseAmount(selected.unitPrice, draft.quantity),
              shippingAmount: '0.00',
              payableAmount: purchaseAmount(selected.unitPrice, draft.quantity),
              recipient: {
                name: draft.recipientName!,
                phone: draft.recipientPhone!,
                address: draft.recipientAddress!,
              },
            }
          : null;
      if (previous && draft.confirmation) {
        if (previous.unitPrice !== draft.confirmation.unitPrice)
          issues.push({ code: 'price_changed' });
        else if (
          [
            'name',
            'color',
            'size',
            'imageUrl',
            'productExternalId',
            'skuId',
            'currency',
          ].some(
            (key) =>
              previous[key as keyof typeof previous] !==
              draft.confirmation![key as keyof typeof previous],
          )
        )
          issues.push({ code: 'specification_changed' });
        else {
          // 重新确认提示保持到下次有效用户修改，避免轮询反复增版。
          if (!userChanged)
            issues.push(
              ...draft.issues.filter((issue) =>
                ['price_changed', 'specification_changed'].includes(issue.code),
              ),
            );
        }
      }
      draft.issues = issues;
    }
    if (
      !userChanged &&
      !isDeepStrictEqual(before, {
        status: draft.status,
        confirmation: draft.confirmation,
        issues: draft.issues,
      })
    )
      draft.version += 1;
    if (draft.confirmation) draft.confirmation.version = draft.version;
  }

  public project(draft: ChatPurchaseDraft): PurchaseDraftResponse {
    return {
      id: draft.id,
      conversationId: draft.conversationId,
      productExternalId: draft.productExternalId,
      skuId: draft.skuId,
      quantity: draft.quantity,
      recipient: {
        name: draft.recipientName,
        phone: draft.recipientPhone,
        address: draft.recipientAddress,
      },
      status: draft.status,
      version: draft.version,
      confirmation: structuredClone(draft.confirmation),
      issues: structuredClone(draft.issues),
      orderId: draft.orderId,
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
      expiresAt: draft.expiresAt.toISOString(),
    };
  }
}
