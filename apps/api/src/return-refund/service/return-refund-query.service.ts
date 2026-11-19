import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  ORDER_RETURN_REFUND_READER,
  type OrderReturnRefundReaderPort,
} from '../../orders/index.js';
import type {
  AdminReturnRefundQuery,
  ReturnRefundUserQuery,
} from '../dto/return-refund.schema.js';
import type {
  AdminReturnRefundDetail,
  ChatOrderCandidate,
  ChatOrderOptions,
  ReturnRefundDetail,
  ReturnRefundOrderOptions,
  ReturnRefundPage,
  ReturnRefundSummary,
} from '../dto/return-refund-response.dto.js';
import { ReturnRefundService } from './return-refund.service.js';

@Injectable()
export class ReturnRefundQueryService {
  public constructor(
    private readonly refunds: ReturnRefundService,
    @Inject(ORDER_RETURN_REFUND_READER)
    private readonly orders: OrderReturnRefundReaderPort,
  ) {}

  public listForUser(
    userId: string,
    query: ReturnRefundUserQuery,
  ): Promise<ReturnRefundPage<ReturnRefundSummary>> {
    return this.refunds.listForUser(userId, query);
  }

  public getForUser(
    userId: string,
    applicationId: string,
  ): Promise<ReturnRefundDetail> {
    return this.refunds.getForUser(userId, applicationId);
  }

  public listForAdmin(
    query: AdminReturnRefundQuery,
  ): Promise<ReturnRefundPage<ReturnRefundSummary>> {
    return this.refunds.listForAdmin(query);
  }

  public getForAdmin(applicationId: string): Promise<AdminReturnRefundDetail> {
    return this.refunds.getForAdmin(applicationId);
  }

  public async getOptionsForUser(
    userId: string,
    orderId: string,
  ): Promise<ReturnRefundOrderOptions> {
    const options = await this.refunds.getOrderOptionsForChat(userId, orderId);
    if (!options) throw new NotFoundException('订单不存在');
    return options;
  }

  public async listOrdersForChat(
    userId: string,
  ): Promise<ChatOrderCandidate[]> {
    return (await this.orders.listReturnRefundOrdersForUser(userId)).map(
      (order) => ({
        ...order,
        completedAt: order.completedAt?.toISOString() ?? null,
      }),
    );
  }

  public getOrderOptionsForChat(
    userId: string,
    orderId: string,
  ): Promise<ChatOrderOptions | null> {
    return this.refunds.getOrderOptionsForChat(userId, orderId);
  }
}
