import { createHash } from 'node:crypto';
import { tool } from '@langchain/core/tools';

import type {
  ReturnRefundQueryService,
  ReturnRefundService,
} from '../../return-refund/index.js';
import {
  createReturnRefundApplicationInputSchema,
  createReturnRefundApplicationResultSchema,
  getMyReturnRefundItemsInputSchema,
  getMyReturnRefundItemsResultSchema,
  listMyReturnRefundOrdersInputSchema,
  listMyReturnRefundOrdersResultSchema,
  type CreateReturnRefundApplicationInput,
  type GetMyReturnRefundItemsInput,
} from '../dto/chat-return-refund.dto.js';

type ChatQueryReader = Pick<
  ReturnRefundQueryService,
  'listOrdersForChat' | 'getOrderOptionsForChat'
>;
type ChatDraftCreator = Pick<ReturnRefundService, 'createDraftFromChat'>;

function uuidFromToolCall(
  userId: string,
  conversationId: string,
  toolCallId: string,
) {
  // 同一 LangGraph tool-call 重试必须复用幂等键，避免创建重复申请。
  const namespace = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');
  const name = Buffer.from(
    `return-refund:${userId}:${conversationId}:${toolCallId}`,
    'utf8',
  );
  const bytes = createHash('sha1')
    .update(Buffer.concat([namespace, name]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const value = bytes.toString('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function createListMyReturnRefundOrdersTool(
  reader: ChatQueryReader,
  userId: string,
  onRequested: () => void,
) {
  return tool(
    async () => {
      onRequested();
      try {
        const result = await reader.listOrdersForChat(userId);
        const parsed = listMyReturnRefundOrdersResultSchema.safeParse({
          ok: true,
          items: result,
        });
        return JSON.stringify(
          parsed.success ? parsed.data : { ok: false, code: 'unavailable' },
        );
      } catch {
        return JSON.stringify({ ok: false, code: 'unavailable' });
      }
    },
    {
      name: 'list_my_return_refund_orders',
      description:
        '查询当前用户本人最近的订单摘要，用于用户明确要求申请退货退款且未明确订单时协助选择。最多5笔，只返回订单号、状态、完成时间和商品数量；不含收件或发货物流信息。不自动判断商家政策或法定资格，不执行任何订单或退款动作。',
      schema: listMyReturnRefundOrdersInputSchema,
    },
  );
}

export function createGetMyReturnRefundItemsTool(
  reader: ChatQueryReader,
  userId: string,
  onRequested: () => void,
) {
  return tool(
    async (input: GetMyReturnRefundItemsInput) => {
      onRequested();
      try {
        const order = await reader.getOrderOptionsForChat(
          userId,
          input.orderId,
        );
        if (!order) return JSON.stringify({ ok: false, code: 'not_found' });
        const parsed = getMyReturnRefundItemsResultSchema.safeParse({
          ok: true,
          order,
        });
        return JSON.stringify(
          parsed.success ? parsed.data : { ok: false, code: 'unavailable' },
        );
      } catch {
        return JSON.stringify({ ok: false, code: 'unavailable' });
      }
    },
    {
      name: 'get_my_return_refund_items',
      description:
        '按可信订单 ID 查询当前用户本人订单中的商品明细、订单快照单价和剩余可申请数量。订单 ID 必须来自本人订单查询；有歧义先询问。返回状态和数量只是申请初筛信息，不代表商家已受理或退款资格最终成立。不返回收件/发货物流信息。',
      schema: getMyReturnRefundItemsInputSchema,
    },
  );
}

export function createReturnRefundApplicationTool(
  service: ChatDraftCreator,
  userId: string,
  conversationId: string,
  onRequested: () => void,
) {
  return tool(
    async (input: CreateReturnRefundApplicationInput, runtime) => {
      onRequested();
      try {
        const runtimeValues = runtime as {
          toolCallId?: unknown;
          toolCall?: { id?: unknown };
          config?: { toolCall?: { id?: unknown } };
        };
        const toolCallId =
          typeof runtimeValues.toolCallId === 'string'
            ? runtimeValues.toolCallId
            : typeof runtimeValues.toolCall?.id === 'string'
              ? runtimeValues.toolCall.id
              : typeof runtimeValues.config?.toolCall?.id === 'string'
                ? runtimeValues.config.toolCall.id
                : undefined;
        if (!toolCallId)
          return JSON.stringify({ ok: false, code: 'unavailable' });
        const idempotencyKey = uuidFromToolCall(
          userId,
          conversationId,
          toolCallId,
        );
        const result = await service.createDraftFromChat(
          userId,
          {
            orderId: input.orderId,
            items: input.items,
            reason: input.reason,
          },
          idempotencyKey,
        );
        const parsed = createReturnRefundApplicationResultSchema.safeParse({
          ok: true,
          ...result,
        });
        return JSON.stringify(
          parsed.success ? parsed.data : { ok: false, code: 'unavailable' },
        );
      } catch {
        return JSON.stringify({ ok: false, code: 'unavailable' });
      }
    },
    {
      name: 'create_return_refund_application',
      description:
        '创建本人订单的退货退款申请草稿。本工具会产生实际写入：只有用户已明确选择订单、商品和数量、提供原因，并在助手展示订单号/商品/数量/固定金额/原因摘要后再次明确同意创建，才可调用。不得把用户的一般退货意图视为最终确认。仅创建“待用户提交”草稿，用户仍须到订单页核对并正式提交；超期或状态不明确申请仍交人工审核，不自动拒绝。本工具不执行真实退款、不提交商家、不取消订单、不接受userId、金额、附件或物流参数。',
      schema: createReturnRefundApplicationInputSchema,
    },
  );
}
