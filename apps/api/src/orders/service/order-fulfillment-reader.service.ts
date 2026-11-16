import { IsolationLevel } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import {
  orderFulfillmentLookupResultSchema,
  orderFulfillmentLookupSchema,
  type OrderFulfillmentLookupInput,
  type OrderFulfillmentLookupResult,
} from '../dto/order-fulfillment-lookup.dto.js';
import { Order } from '../entity/order.entity.js';

type OrderFulfillmentRow = {
  order_no: string;
  status: string;
  shipped_at: Date | string | null;
  completed_at: Date | string | null;
};

function toIsoTime(value: Date | string | null): string | null {
  if (value === null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

@Injectable()
export class OrderFulfillmentReaderService {
  public constructor(
    @InjectRepository(Order)
    private readonly orders: EntityRepository<Order>,
  ) {}

  public async getForChat(
    userId: string,
    query: OrderFulfillmentLookupInput,
  ): Promise<OrderFulfillmentLookupResult> {
    const input = orderFulfillmentLookupSchema.parse(query);

    try {
      const em = this.orders.getEntityManager().fork({
        clear: true,
        useContext: false,
        keepTransactionContext: false,
      });

      // 独立只读快照不继承待写实体，也不触发订单详情中的到期处理。
      return await em.transactional(
        async (transaction): Promise<OrderFulfillmentLookupResult> => {
          const context = transaction.getTransactionContext();
          if (!context) throw new Error('履约查询缺少只读事务');
          const rows = await transaction
            .getConnection()
            .execute<OrderFulfillmentRow[]>(
              `select order_no, status, shipped_at, completed_at
               from orders
               where user_id = ?::uuid and order_no = ?
               limit 1`,
              [userId, input.orderNo],
              'all',
              context,
            );
          const row = rows[0];
          if (!row) return { ok: false, code: 'not_found' };

          // 查询与响应都限定既有聊天白名单，不读取收件信息、承运商或单号。
          return orderFulfillmentLookupResultSchema.parse({
            ok: true,
            source: 'local_order_record',
            realtimeTrackingAvailable: false,
            order: {
              orderNo: row.order_no,
              status: row.status,
              shippedAt: toIsoTime(row.shipped_at),
              completedAt: toIsoTime(row.completed_at),
            },
          });
        },
        { isolationLevel: IsolationLevel.REPEATABLE_READ, readOnly: true },
      );
    } catch {
      // 依赖故障和异常记录统一失败，不把内部错误解释为未发货。
      return { ok: false, code: 'unavailable' };
    }
  }
}
