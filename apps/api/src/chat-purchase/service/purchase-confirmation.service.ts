import { Inject, Injectable, ConflictException } from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ORDER_CONFIRMED_CREATION_PORT,
  type OrderConfirmedCreationPort,
  type OrderDetailResponseDto,
  OrdersService,
} from '../../orders/index.js';
import type { PurchaseDraftResponse } from '../dto/chat-purchase-response.js';
import { PurchaseDraftService } from './purchase-draft.service.js';
import { PurchaseProjectionService } from './purchase-projection.service.js';

/** 正式订单和草稿关联共享调用方事务；业务失效先提交，再返回冲突。 */
@Injectable()
export class PurchaseConfirmationService {
  public constructor(
    private readonly drafts: PurchaseDraftService,
    private readonly projection: PurchaseProjectionService,
    @Inject(ORDER_CONFIRMED_CREATION_PORT)
    private readonly creator: OrderConfirmedCreationPort,
    private readonly orders: OrdersService,
  ) {}

  public async confirm(
    userId: string,
    conversationId: string,
    draftId: string,
    expectedVersion: number,
    recovering = false,
  ): Promise<{
    draft: PurchaseDraftResponse;
    order: OrderDetailResponseDto;
    created: boolean;
  }> {
    let result;
    try {
      result = await this.drafts
        .manager()
        .transactional(async (transaction) => {
          const draft = await this.drafts.lock(
            transaction,
            userId,
            conversationId,
            draftId,
          );
          // 成功版本恢复优先于商品、期限和当前草稿版本校验。
          if (
            draft.status === 'submitted' &&
            draft.submittedVersion === expectedVersion &&
            draft.orderId
          )
            return {
              draft: this.projection.project(draft),
              orderId: draft.orderId,
              created: false,
            };
          if (
            draft.version !== expectedVersion ||
            draft.status !== 'ready' ||
            !draft.confirmation
          )
            throw new ConflictException('购买草稿版本或状态已变化，请重新读取');
          const quote = draft.confirmation;
          const outcome = await this.creator.createConfirmedInTransaction(
            transaction,
            userId,
            {
              idempotencyKey: draft.submissionKey,
              items: [{ skuId: quote.skuId, quantity: draft.quantity }],
              recipient: quote.recipient,
            },
            {
              productExternalId: quote.productExternalId,
              skuId: quote.skuId,
              productName: quote.name,
              color: quote.color,
              size: quote.size,
              currency: quote.currency,
              unitPrice: quote.unitPrice,
              imageUrl: quote.imageUrl,
              expiresAt: draft.expiresAt,
            },
          );
          if (outcome.kind !== 'created' && outcome.kind !== 'replayed') {
            if (outcome.kind === 'draft_expired') {
              draft.status = 'expired';
              draft.confirmation = null;
              draft.issues = [{ code: 'expired' }];
              draft.version += 1;
            } else await this.drafts.refresh(transaction, draft);
            await transaction.flush();
            return { conflict: true as const };
          }
          draft.status = 'submitted';
          draft.submittedVersion = expectedVersion;
          draft.version += 1;
          draft.orderId = outcome.order.id;
          if (draft.confirmation) draft.confirmation.version = draft.version;
          await transaction.flush();
          return {
            draft: this.projection.project(draft),
            orderId: outcome.order.id,
            created: outcome.kind === 'created',
          };
        });
    } catch (error) {
      // PostgreSQL 唯一冲突后的事务已经中止，只能在外层重新获取锁恢复结果。
      if (!recovering && error instanceof UniqueConstraintViolationException)
        return this.confirm(
          userId,
          conversationId,
          draftId,
          expectedVersion,
          true,
        );
      throw error;
    }
    if ('conflict' in result)
      throw new ConflictException('购买条件已变化，请查看最新确认信息');
    return {
      draft: result.draft,
      order: await this.orders.getForUser(userId, result.orderId),
      created: result.created,
    };
  }
}
