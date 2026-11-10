import { HttpException } from '@nestjs/common';
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

import { OrderStatus } from '../entity/order.entity.js';
import { CustomerOrderQueryDto } from '../dto/order-query.dto.js';
import type { OrdersService } from '../service/orders.service.js';

export const listUserOrdersToolSchema = z.strictObject({
  orderNo: z.string().trim().min(1).max(100).optional(),
  status: z
    .enum(Object.values(OrderStatus) as [OrderStatus, ...OrderStatus[]])
    .optional(),
  page: z.number().int().safe().min(1).max(10).default(1),
});

type SafeOrderItem = {
  productName: string;
  color: string;
  size: string;
  quantity: number;
};

type SafeOrder = {
  orderNo: string;
  status: OrderStatus;
  closeReason: string | null;
  itemsAmount: string;
  payableAmount: string;
  itemCount: number;
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  completedAt: string | null;
  items: SafeOrderItem[];
};

type SafeCancellationCandidate = {
  orderId: string;
  orderNo: string;
  status: OrderStatus.PENDING_PAYMENT;
  cancelable: true;
  payableAmount: string;
  createdAt: string;
  expiresAt: string;
  items: SafeOrderItem[];
};

function safeOrder(
  summary: Awaited<ReturnType<OrdersService['listForUser']>>['items'][number],
  items: Awaited<ReturnType<OrdersService['getForUser']>>['items'],
): SafeOrder {
  return {
    orderNo: summary.orderNo,
    status: summary.status,
    closeReason: summary.closeReason,
    itemsAmount: summary.itemsAmount,
    payableAmount: summary.payableAmount,
    itemCount: summary.itemCount,
    createdAt: summary.createdAt,
    paidAt: summary.paidAt,
    shippedAt: summary.shippedAt,
    completedAt: summary.completedAt,
    items: items.map(({ productName, color, size, quantity }) => ({
      productName,
      color,
      size,
      quantity,
    })),
  };
}

function safeCancellationCandidate(
  summary: Awaited<ReturnType<OrdersService['listForUser']>>['items'][number],
  items: Awaited<ReturnType<OrdersService['getForUser']>>['items'],
): SafeCancellationCandidate {
  return {
    orderId: summary.id,
    orderNo: summary.orderNo,
    status: OrderStatus.PENDING_PAYMENT,
    cancelable: true,
    payableAmount: summary.payableAmount,
    createdAt: summary.createdAt,
    expiresAt: summary.expiresAt,
    items: items.map(({ productName, color, size, quantity }) => ({
      productName,
      color,
      size,
      quantity,
    })),
  };
}

/** 用户 ID 仅由调用方闭包绑定，模型参数无法指定查询归属。 */
export function createListUserOrdersTool(
  orders: Pick<
    OrdersService,
    'listForUser' | 'getForUser' | 'listCancelableForUser'
  >,
  boundUserId: string,
): StructuredToolInterface {
  return tool(
    async ({ orderNo, status, page }) => {
      try {
        const query = Object.assign(new CustomerOrderQueryDto(), {
          page,
          pageSize: 5,
          ...(orderNo ? { orderNo } : {}),
          ...(status ? { status } : {}),
        });
        if (status === OrderStatus.PENDING_PAYMENT) {
          const candidates = await orders.listCancelableForUser(
            boundUserId,
            orderNo,
          );
          const safeOrders = await Promise.all(
            candidates.map(async (summary) => {
              const detail = await orders.getForUser(boundUserId, summary.id);
              return safeCancellationCandidate(summary, detail.items);
            }),
          );
          return JSON.stringify({ ok: true, orders: safeOrders });
        }
        const result = await orders.listForUser(boundUserId, query);

        // 列表服务不返回商品明细；只对固定上限的本人订单读取快照并立即白名单投影。
        const safeOrders = await Promise.all(
          result.items.slice(0, 5).map(async (summary) => {
            const detail = await orders.getForUser(boundUserId, summary.id);
            return safeOrder(summary, detail.items);
          }),
        );
        return JSON.stringify({ ok: true, orders: safeOrders });
      } catch (error) {
        const statusCode =
          error instanceof HttpException ? error.getStatus() : undefined;
        return JSON.stringify({
          ok: false,
          code:
            statusCode === 409
              ? 'conflict'
              : statusCode === 404
                ? 'not_found'
                : 'unavailable',
        });
      }
    },
    {
      name: 'list_my_orders',
      description:
        '查询当前用户最多 5 笔订单的安全摘要，可按订单号或状态筛选；待付款筛选仅返回数据库判定未过期的本人订单及受限取消引用。不提供收件信息，也不执行订单操作。',
      schema: listUserOrdersToolSchema,
    },
  );
}
