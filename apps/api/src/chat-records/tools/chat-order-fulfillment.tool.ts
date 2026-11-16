import { tool } from '@langchain/core/tools';

import {
  orderFulfillmentLookupResultSchema,
  orderFulfillmentLookupSchema,
  type OrderFulfillmentLookupInput,
  type OrderFulfillmentReaderService,
} from '../../orders/index.js';

export function createChatOrderFulfillmentTool(
  reader: Pick<OrderFulfillmentReaderService, 'getForChat'>,
  userId: string,
  onRequested: () => void,
) {
  return tool(
    async (input: OrderFulfillmentLookupInput) => {
      // 身份绑定服务端上下文；成功、未找到和故障都保留本轮来源隔离。
      onRequested();
      try {
        const result = await reader.getForChat(userId, input);
        const projection = result.ok
          ? {
              ok: result.ok,
              source: result.source,
              realtimeTrackingAvailable: result.realtimeTrackingAvailable,
              order: {
                orderNo: result.order.orderNo,
                status: result.order.status,
                shippedAt: result.order.shippedAt,
                completedAt: result.order.completedAt,
              },
            }
          : { ok: result.ok, code: result.code };
        // 二次白名单与严格校验避免领域扩展后把物流私密字段带入模型。
        const parsed = orderFulfillmentLookupResultSchema.safeParse(projection);
        return JSON.stringify(
          parsed.success ? parsed.data : { ok: false, code: 'unavailable' },
        );
      } catch {
        return JSON.stringify({ ok: false, code: 'unavailable' });
      }
    },
    {
      name: 'get_my_order_fulfillment',
      description:
        '按明确订单号查询当前用户本人订单的本地履约状态、发货时间和完成时间。订单号须来自用户明确提供或可信订单查询结果，不能猜测；有歧义时先查询订单摘要或询问用户。只反映本站记录，不提供承运商实时轨迹、物流单号、预计送达或签收凭据；已登记发货不等于已揽件，订单完成不等于承运商签收。不执行支付、取消、发货或确认收货。',
      schema: orderFulfillmentLookupSchema,
    },
  );
}
