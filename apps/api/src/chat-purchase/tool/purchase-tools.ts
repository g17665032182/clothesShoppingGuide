import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { HttpException } from '@nestjs/common';
import {
  patchPurchaseSchema,
  purchaseVersionSchema,
} from '../dto/chat-purchase.schema.js';
import type { PurchaseDraftService } from '../service/purchase-draft.service.js';
import type { PurchaseDraftResponse } from '../dto/chat-purchase-response.js';

function safeDraft(draft: PurchaseDraftResponse | null) {
  return draft
    ? {
        draftId: draft.id,
        version: draft.version,
        status: draft.status,
        skuId: draft.skuId,
        quantity: draft.quantity,
        issues: draft.issues,
        orderId: draft.orderId,
        filled: {
          name: Boolean(draft.recipient.name),
          phone: Boolean(draft.recipient.phone),
          address: Boolean(draft.recipient.address),
        },
      }
    : null;
}

/** 工具绑定服务端身份，只能读改草稿，正式订单动作没有模型入口。 */
export function createPurchaseTools(
  drafts: PurchaseDraftService,
  userId: string,
  conversationId: string,
  used: (draftId?: string) => void,
) {
  const invoke = async (action: () => Promise<unknown>) => {
    used();
    try {
      return JSON.stringify({ ok: true, result: await action() });
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 503;
      return JSON.stringify({
        ok: false,
        code:
          status === 409
            ? 'version_conflict'
            : status === 404
              ? 'not_found'
              : 'unavailable',
      });
    }
  };
  return [
    tool(
      () =>
        invoke(async () => {
          const state = await drafts.runState(userId, conversationId);
          if (state.reference) used(state.reference.draftId);
          return state.context
            ? (JSON.parse(state.context) as unknown)
            : { draft: null, reference: state.reference };
        }),
      {
        name: 'get_purchase_draft',
        description:
          '读取本人当前购买草稿、真实规格和缺失字段，不返回收货字段值。',
        schema: z.strictObject({}),
      },
    ),
    tool(
      ({ draftId, ...input }) =>
        invoke(async () => {
          const result = await drafts.patch(
            userId,
            conversationId,
            draftId,
            input,
          );
          used(result.id);
          return safeDraft(result);
        }),
      {
        name: 'update_purchase_draft',
        description:
          '仅更新用户本次明确提供的规格或收货信息。歧义先询问。必须使用当前草稿版本。',
        schema: patchPurchaseSchema.safeExtend({ draftId: z.uuid() }),
      },
    ),
    tool(
      ({ draftId, expectedVersion }) =>
        invoke(async () => {
          const result = await drafts.discard(
            userId,
            conversationId,
            draftId,
            expectedVersion,
          );
          used(result.id);
          return safeDraft(result);
        }),
      {
        name: 'discard_purchase_draft',
        description: '仅放弃未提交的购买草稿，不取消正式订单。',
        schema: purchaseVersionSchema.extend({ draftId: z.uuid() }),
      },
    ),
  ];
}
