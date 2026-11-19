import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  LockMode,
  UniqueConstraintViolationException,
  type EntityManager,
} from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import {
  ORDER_RETURN_REFUND_READER,
  type OrderReturnRefundReaderPort,
  type ReturnRefundOrderSnapshot,
} from '../../orders/index.js';
import {
  type AdminReturnRefundDetail,
  type ReturnRefundChatDraftResult,
  type ReturnRefundDetail,
  type ReturnRefundEvidenceDto,
  type ReturnRefundItemDto,
  type ReturnRefundOrderOptions,
  type ReturnRefundPage,
  type ReturnRefundSummary,
} from '../dto/return-refund-response.dto.js';
import type {
  AdminReturnRefundQuery,
  CreateAndSubmitReturnRefundInput,
  RejectReturnRefundInput,
  ReturnRefundUserQuery,
  ReturnRefundShipmentInput,
  SubmitReturnRefundInput,
} from '../dto/return-refund.schema.js';
import { ReturnRefundApplication } from '../entity/return-refund-application.entity.js';
import { ReturnRefundStatus } from '../entity/return-refund-application.entity.js';
import { ReturnRefundEvent } from '../entity/return-refund-event.entity.js';
import { ReturnRefundEvidence } from '../entity/return-refund-evidence.entity.js';
import { ReturnRefundItem } from '../entity/return-refund-item.entity.js';
import {
  RETURN_REFUND_ELIGIBILITY_POLICY,
  type ReturnRefundEligibilityPolicy,
} from '../port/return-refund-eligibility.port.js';

const terminalStatuses = [
  ReturnRefundStatus.REJECTED,
  ReturnRefundStatus.CANCELLED,
  ReturnRefundStatus.REFUNDED,
];
const activeStatuses = Object.values(ReturnRefundStatus).filter(
  (status) => !terminalStatuses.includes(status),
);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type CreateReturnRefundDraftInput = {
  orderId: string;
  items: Array<{ orderItemId: string; quantity: number }>;
  reason: string;
};

type NormalizedItem = { orderItemId: string; quantity: number };

@Injectable()
export class ReturnRefundService {
  public constructor(
    @InjectRepository(ReturnRefundApplication)
    private readonly applications: EntityRepository<ReturnRefundApplication>,
    @InjectRepository(ReturnRefundItem)
    private readonly applicationItems: EntityRepository<ReturnRefundItem>,
    @Inject(ORDER_RETURN_REFUND_READER)
    private readonly orderReader: OrderReturnRefundReaderPort,
    @Optional()
    @Inject(RETURN_REFUND_ELIGIBILITY_POLICY)
    private readonly eligibilityPolicy?: ReturnRefundEligibilityPolicy,
    @Optional()
    @InjectRepository(ReturnRefundEvidence)
    private readonly evidence?: EntityRepository<ReturnRefundEvidence>,
  ) {}

  public async createDraftFromChat(
    userId: string,
    input: CreateReturnRefundDraftInput,
    idempotencyKey: string,
  ): Promise<ReturnRefundChatDraftResult> {
    this.assertUuid(userId);
    this.assertUuid(idempotencyKey);
    const request = this.normalizeInput(input);
    const hash = this.requestHash('chat_draft', request);
    const em = this.manager();
    try {
      return await em.transactional(async (transaction) => {
        const replay = await this.lockIdempotency(
          transaction,
          userId,
          idempotencyKey,
          hash,
        );
        if (replay) return this.chatDraftProjection(transaction, replay);
        const order = await this.orderReader.getReturnRefundOrderInTransaction(
          transaction,
          userId,
          request.orderId,
        );
        if (!order) throw new NotFoundException('订单不存在');
        const application = await this.createLockedApplication(
          transaction,
          userId,
          idempotencyKey,
          hash,
          order,
          request.items,
          request.reason,
          ReturnRefundStatus.PENDING_USER_SUBMISSION,
          {
            manualReviewRequired: false,
            manualReviewReason: null,
          },
        );
        return this.chatDraftProjection(transaction, application);
      });
    } catch (error) {
      if (!(error instanceof UniqueConstraintViolationException)) throw error;
      return this.readIdempotentChatDraft(userId, idempotencyKey, hash);
    }
  }

  public async createAndSubmitForUser(
    userId: string,
    orderId: string,
    input: Omit<CreateAndSubmitReturnRefundInput, 'idempotencyKey'>,
    idempotencyKey: string,
  ): Promise<ReturnRefundDetail> {
    this.assertUuid(userId);
    this.assertUuid(orderId);
    this.assertUuid(idempotencyKey);
    const request = this.normalizeInput({ ...input, orderId });
    const hash = this.requestHash('direct_submit', request);
    const em = this.manager();
    try {
      return await em.transactional(async (transaction) => {
        const replay = await this.lockIdempotency(
          transaction,
          userId,
          idempotencyKey,
          hash,
        );
        if (replay) return this.detailProjection(transaction, replay);
        const order = await this.orderReader.getReturnRefundOrderInTransaction(
          transaction,
          userId,
          orderId,
        );
        if (!order) throw new NotFoundException('订单不存在');
        const eligibility = await this.evaluateEligibility(order, transaction);
        const application = await this.createLockedApplication(
          transaction,
          userId,
          idempotencyKey,
          hash,
          order,
          request.items,
          request.reason,
          ReturnRefundStatus.PENDING_REVIEW,
          eligibility,
        );
        application.submittedAt = await this.databaseNow(transaction);
        await transaction.flush();
        return this.detailProjection(transaction, application);
      });
    } catch (error) {
      if (!(error instanceof UniqueConstraintViolationException)) throw error;
      return this.readIdempotentDetail(userId, idempotencyKey, hash);
    }
  }

  public async submitDraft(
    userId: string,
    applicationId: string,
    input: SubmitReturnRefundInput,
  ): Promise<ReturnRefundDetail> {
    const em = this.manager();
    return em.transactional(async (transaction) => {
      const candidate = await transaction.findOne(ReturnRefundApplication, {
        id: applicationId,
        userId,
      });
      if (!candidate) throw new NotFoundException('售后申请不存在');
      const order = await this.orderReader.getReturnRefundOrderInTransaction(
        transaction,
        userId,
        candidate.orderId,
      );
      if (!order) throw new NotFoundException('售后申请不存在');
      const application = await transaction.findOne(
        ReturnRefundApplication,
        { id: applicationId, userId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!application) throw new NotFoundException('售后申请不存在');
      if (application.version !== input.version)
        throw new ConflictException('售后申请已更新，请刷新后重试');
      if (application.status !== ReturnRefundStatus.PENDING_USER_SUBMISSION)
        throw new ConflictException('申请当前状态不能提交');
      const eligibility = await this.evaluateEligibility(order, transaction);
      application.status = ReturnRefundStatus.PENDING_REVIEW;
      application.manualReviewRequired = eligibility.manualReviewRequired;
      application.manualReviewReason = eligibility.manualReviewReason;
      application.submittedAt = await this.databaseNow(transaction);
      application.version += 1;
      application.updatedAt = application.submittedAt;
      this.recordEvent(
        transaction,
        application,
        'user_submitted',
        ReturnRefundStatus.PENDING_USER_SUBMISSION,
        userId,
        'user',
      );
      await transaction.flush();
      return this.detailProjection(transaction, application);
    });
  }

  public async cancelForUser(
    userId: string,
    applicationId: string,
  ): Promise<ReturnRefundDetail> {
    const em = this.manager();
    return em.transactional(async (transaction) => {
      const candidate = await transaction.findOne(ReturnRefundApplication, {
        id: applicationId,
        userId,
      });
      if (!candidate) throw new NotFoundException('售后申请不存在');
      const order = await this.orderReader.getReturnRefundOrderInTransaction(
        transaction,
        userId,
        candidate.orderId,
      );
      if (!order) throw new NotFoundException('售后申请不存在');
      const application = await transaction.findOne(
        ReturnRefundApplication,
        { id: applicationId, userId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!application) throw new NotFoundException('售后申请不存在');
      if (
        application.status !== ReturnRefundStatus.PENDING_USER_SUBMISSION &&
        application.status !== ReturnRefundStatus.PENDING_REVIEW
      )
        throw new ConflictException('申请当前状态不能取消');
      const previous = application.status;
      application.status = ReturnRefundStatus.CANCELLED;
      application.cancelledAt = await this.databaseNow(transaction);
      application.version += 1;
      application.updatedAt = application.cancelledAt;
      this.recordEvent(
        transaction,
        application,
        'user_cancelled',
        previous,
        userId,
        'user',
      );
      await transaction.flush();
      return this.detailProjection(transaction, application);
    });
  }

  public async setReturnShipmentForUser(
    userId: string,
    applicationId: string,
    input: ReturnRefundShipmentInput,
  ): Promise<ReturnRefundDetail> {
    const em = this.manager();
    return em.transactional(async (transaction) => {
      const application = await this.lockOwnedApplication(
        transaction,
        userId,
        applicationId,
      );
      if (application.version !== input.version)
        throw new ConflictException('售后申请已更新，请刷新后重试');
      if (application.status !== ReturnRefundStatus.APPROVED_PENDING_RETURN)
        throw new ConflictException('申请当前状态不能登记退货物流');
      application.returnCarrier = input.carrier;
      application.returnTrackingNo = input.trackingNo;
      const now = await this.databaseNow(transaction);
      application.status = ReturnRefundStatus.RETURNED_BY_USER;
      application.returnedAt = now;
      application.updatedAt = now;
      application.version += 1;
      this.recordEvent(
        transaction,
        application,
        'user_returned',
        ReturnRefundStatus.APPROVED_PENDING_RETURN,
        userId,
        'user',
      );
      await transaction.flush();
      return this.detailProjection(transaction, application);
    });
  }

  public async approveForAdmin(
    adminId: string,
    applicationId: string,
    version: number,
  ): Promise<AdminReturnRefundDetail> {
    return this.adminTransition(
      adminId,
      applicationId,
      version,
      ReturnRefundStatus.PENDING_REVIEW,
      ReturnRefundStatus.APPROVED_PENDING_RETURN,
      'admin_approved',
      'approvedAt',
    );
  }

  public async rejectForAdmin(
    adminId: string,
    applicationId: string,
    input: RejectReturnRefundInput,
  ): Promise<AdminReturnRefundDetail> {
    return this.adminTransition(
      adminId,
      applicationId,
      input.version,
      ReturnRefundStatus.PENDING_REVIEW,
      ReturnRefundStatus.REJECTED,
      'admin_rejected',
      'rejectedAt',
      input.reason,
    );
  }

  public async confirmReceivedForAdmin(
    adminId: string,
    applicationId: string,
    version: number,
  ): Promise<AdminReturnRefundDetail> {
    return this.adminTransition(
      adminId,
      applicationId,
      version,
      ReturnRefundStatus.RETURNED_BY_USER,
      ReturnRefundStatus.PENDING_INSPECTION,
      'admin_received',
      'receivedAt',
    );
  }

  public async startRefundForAdmin(
    adminId: string,
    applicationId: string,
    version: number,
  ): Promise<AdminReturnRefundDetail> {
    return this.adminTransition(
      adminId,
      applicationId,
      version,
      ReturnRefundStatus.PENDING_INSPECTION,
      ReturnRefundStatus.REFUND_PROCESSING,
      'admin_refund_processing',
      'refundProcessingAt',
    );
  }

  public async markRefundedForAdmin(
    adminId: string,
    applicationId: string,
    version: number,
  ): Promise<AdminReturnRefundDetail> {
    return this.adminTransition(
      adminId,
      applicationId,
      version,
      ReturnRefundStatus.REFUND_PROCESSING,
      ReturnRefundStatus.REFUNDED,
      'admin_refunded',
      'refundedAt',
    );
  }

  public async getForUser(
    userId: string,
    applicationId: string,
  ): Promise<ReturnRefundDetail> {
    const application = await this.applications.findOne({
      id: applicationId,
      userId,
    });
    if (!application) throw new NotFoundException('售后申请不存在');
    return this.detailProjection(
      this.applications.getEntityManager(),
      application,
    );
  }

  public async getForAdmin(
    applicationId: string,
  ): Promise<AdminReturnRefundDetail> {
    const application = await this.applications.findOne({ id: applicationId });
    if (!application) throw new NotFoundException('售后申请不存在');
    return this.adminDetailProjection(
      this.applications.getEntityManager(),
      application,
    );
  }

  public async listForUser(
    userId: string,
    query: ReturnRefundUserQuery,
  ): Promise<ReturnRefundPage<ReturnRefundSummary>> {
    const filter = {
      userId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await this.applications.findAndCount(filter, {
      orderBy: [{ createdAt: 'DESC' }, { id: 'DESC' }],
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    const itemCounts = await this.itemCountsFor(rows);
    return {
      items: rows.map((row) =>
        this.summaryProjection(row, itemCounts.get(row.id) ?? 0),
      ),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  public async listForAdmin(
    query: AdminReturnRefundQuery,
  ): Promise<ReturnRefundPage<ReturnRefundSummary>> {
    const filter = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.manualReviewRequired === undefined
        ? {}
        : { manualReviewRequired: query.manualReviewRequired }),
      ...(query.orderNo ? { orderNo: query.orderNo } : {}),
    };
    const [rows, total] = await this.applications.findAndCount(filter, {
      orderBy: [{ createdAt: 'DESC' }, { id: 'DESC' }],
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    const itemCounts = await this.itemCountsFor(rows);
    return {
      items: rows.map((row) =>
        this.summaryProjection(row, itemCounts.get(row.id) ?? 0),
      ),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  public async listOrdersForChat(userId: string) {
    return (await this.orderReader.listReturnRefundOrdersForUser(userId)).map(
      (order) => ({
        ...order,
        completedAt: order.completedAt?.toISOString() ?? null,
      }),
    );
  }

  public async getOrderOptionsForChat(
    userId: string,
    orderId: string,
  ): Promise<ReturnRefundOrderOptions | null> {
    const order = await this.orderReader.getReturnRefundOrderForUser(
      userId,
      orderId,
    );
    if (!order) return null;
    return this.orderOptionsProjection(userId, order);
  }

  private async adminTransition(
    adminId: string,
    applicationId: string,
    version: number,
    expected: ReturnRefundStatus,
    next: ReturnRefundStatus,
    action: string,
    timestampField:
      | 'approvedAt'
      | 'rejectedAt'
      | 'receivedAt'
      | 'refundProcessingAt'
      | 'refundedAt',
    rejectionReason?: string,
  ): Promise<AdminReturnRefundDetail> {
    const em = this.manager();
    return em.transactional(async (transaction) => {
      const candidate = await transaction.findOne(ReturnRefundApplication, {
        id: applicationId,
      });
      if (!candidate) throw new NotFoundException('售后申请不存在');
      const order = await this.orderReader.getReturnRefundOrderInTransaction(
        transaction,
        candidate.userId,
        candidate.orderId,
      );
      if (!order) throw new NotFoundException('售后申请不存在');
      const application = await transaction.findOne(
        ReturnRefundApplication,
        { id: applicationId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!application) throw new NotFoundException('售后申请不存在');
      if (application.version !== version)
        throw new ConflictException('售后申请已更新，请刷新后重试');
      if (application.status !== expected)
        throw new ConflictException('申请当前状态不允许此操作');
      const previous = application.status;
      application.status = next;
      const now = await this.databaseNow(transaction);
      application[timestampField] = now;
      application.updatedAt = now;
      application.version += 1;
      if (rejectionReason !== undefined)
        application.rejectionReason = rejectionReason;
      this.recordEvent(
        transaction,
        application,
        action,
        previous,
        adminId,
        'admin',
      );
      await transaction.flush();
      return this.adminDetailProjection(transaction, application);
    });
  }

  private async createLockedApplication(
    em: EntityManager,
    userId: string,
    idempotencyKey: string,
    requestHash: string,
    order: ReturnRefundOrderSnapshot,
    requestedItems: NormalizedItem[],
    reason: string,
    status: ReturnRefundStatus,
    eligibility: {
      manualReviewRequired: boolean;
      manualReviewReason: string | null;
    },
  ): Promise<ReturnRefundApplication> {
    const existing = await em.findOne(ReturnRefundApplication, {
      orderId: order.id,
      status: { $in: activeStatuses },
    });
    if (existing) throw new ConflictException('该订单已有未结束的售后申请');

    const itemsById = new Map(
      order.items.map((item) => [item.orderItemId, item]),
    );
    const requested = requestedItems.map((item) => {
      const source = itemsById.get(item.orderItemId);
      if (!source) throw new NotFoundException('订单商品不存在');
      return { source, quantity: item.quantity };
    });
    const refundedQuantities = await this.refundedQuantitiesForOrder(
      em,
      order.id,
    );
    const lines: Array<{
      source: (typeof order.items)[number];
      quantity: number;
      lineAmount: string;
    }> = [];
    let totalMinor = 0n;
    for (const item of requested) {
      const available =
        item.source.quantity -
        (refundedQuantities.get(item.source.orderItemId) ?? 0);
      if (item.quantity > available)
        throw new ConflictException('申请数量超过尚未退款的购买数量');
      const lineMinor =
        this.toMinorUnits(item.source.unitPrice) * BigInt(item.quantity);
      totalMinor += lineMinor;
      lines.push({
        source: item.source,
        quantity: item.quantity,
        lineAmount: this.formatMinorUnits(lineMinor),
      });
    }

    const now = await this.databaseNow(em);
    const application = em.create(ReturnRefundApplication, {
      orderId: order.id,
      userId,
      orderNo: order.orderNo,
      status,
      manualReviewRequired: eligibility.manualReviewRequired,
      manualReviewReason: eligibility.manualReviewReason,
      reason,
      refundAmount: this.formatMinorUnits(totalMinor),
      currency: order.currency,
      idempotencyKey,
      requestHash,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    em.persist(application);
    await em.flush();
    for (const line of lines) {
      em.create(ReturnRefundItem, {
        applicationId: application.id,
        orderItemId: line.source.orderItemId,
        productExternalId: line.source.productExternalId,
        productName: line.source.productName,
        color: line.source.color,
        size: line.source.size,
        imageUrl: line.source.imageUrl,
        unitPrice: line.source.unitPrice,
        quantity: line.quantity,
        lineAmount: line.lineAmount,
      });
    }
    await em.flush();
    this.recordEvent(
      em,
      application,
      status === ReturnRefundStatus.PENDING_USER_SUBMISSION
        ? 'chat_draft_created'
        : 'user_submitted',
      null,
      userId,
      'user',
    );
    await em.flush();
    return application;
  }

  private async evaluateEligibility(
    order: ReturnRefundOrderSnapshot,
    _em: EntityManager,
  ) {
    if (!this.eligibilityPolicy)
      throw new ServiceUnavailableException('售后资格规则暂不可用');
    return this.eligibilityPolicy.evaluate(order, await this.databaseNow(_em));
  }

  private async lockIdempotency(
    em: EntityManager,
    userId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<ReturnRefundApplication | null> {
    await em
      .getConnection()
      .execute(
        'select pg_advisory_xact_lock(hashtextextended(?, 0))',
        [`return-refund-idempotency:${userId}:${idempotencyKey}`],
        'run',
        em.getTransactionContext(),
      );
    const previous = await em.findOne(ReturnRefundApplication, {
      userId,
      idempotencyKey,
    });
    if (!previous) return null;
    if (previous.requestHash !== requestHash)
      throw new ConflictException('幂等键已用于不同申请内容');
    return previous;
  }

  private async readIdempotentChatDraft(
    userId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<ReturnRefundChatDraftResult> {
    const application = await this.applications.findOne({
      userId,
      idempotencyKey,
    });
    if (!application || application.requestHash !== requestHash)
      throw new ConflictException('售后申请幂等记录冲突');
    return this.chatDraftProjection(
      this.applications.getEntityManager(),
      application,
    );
  }

  private async readIdempotentDetail(
    userId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<ReturnRefundDetail> {
    const application = await this.applications.findOne({
      userId,
      idempotencyKey,
    });
    if (!application || application.requestHash !== requestHash)
      throw new ConflictException('售后申请幂等记录冲突');
    return this.detailProjection(
      this.applications.getEntityManager(),
      application,
    );
  }

  private async orderOptionsProjection(
    userId: string,
    order: ReturnRefundOrderSnapshot,
  ): Promise<ReturnRefundOrderOptions> {
    const em = this.manager();
    const refunded = await this.refundedQuantitiesForOrder(em, order.id);
    const active = await this.applications.count({
      userId,
      orderId: order.id,
      status: { $in: activeStatuses },
    });
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      status: order.status,
      completedAt: order.completedAt?.toISOString() ?? null,
      currency: order.currency,
      items: order.items.map((item) => ({
        orderItemId: item.orderItemId,
        productName: item.productName,
        productExternalId: item.productExternalId,
        color: item.color,
        size: item.size,
        imageUrl: item.imageUrl,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        availableQuantity: Math.max(
          0,
          active ? 0 : item.quantity - (refunded.get(item.orderItemId) ?? 0),
        ),
      })),
    };
  }

  private async refundedQuantitiesForOrder(
    em: EntityManager,
    orderId: string,
  ): Promise<Map<string, number>> {
    const refundedApplications = await em.find(
      ReturnRefundApplication,
      { orderId, status: ReturnRefundStatus.REFUNDED },
      { fields: ['id'] },
    );
    if (!refundedApplications.length) return new Map();
    const items = await em.find(ReturnRefundItem, {
      applicationId: {
        $in: refundedApplications.map((application) => application.id),
      },
    });
    const counts = new Map<string, number>();
    for (const item of items)
      counts.set(
        item.orderItemId,
        (counts.get(item.orderItemId) ?? 0) + item.quantity,
      );
    return counts;
  }

  private async lockOwnedApplication(
    em: EntityManager,
    userId: string,
    applicationId: string,
  ) {
    const candidate = await em.findOne(ReturnRefundApplication, {
      id: applicationId,
      userId,
    });
    if (!candidate) throw new NotFoundException('售后申请不存在');
    const order = await this.orderReader.getReturnRefundOrderInTransaction(
      em,
      userId,
      candidate.orderId,
    );
    if (!order) throw new NotFoundException('售后申请不存在');
    const application = await em.findOne(
      ReturnRefundApplication,
      { id: applicationId, userId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (!application) throw new NotFoundException('售后申请不存在');
    return application;
  }

  private async detailProjection(
    em: EntityManager,
    application: ReturnRefundApplication,
  ): Promise<ReturnRefundDetail> {
    const [items, evidence] = await Promise.all([
      em.find(
        ReturnRefundItem,
        { applicationId: application.id },
        { orderBy: { id: 'ASC' } },
      ),
      this.evidence
        ? em.find(
            ReturnRefundEvidence,
            { applicationId: application.id, deletedAt: null },
            { orderBy: [{ createdAt: 'ASC' }, { id: 'ASC' }] },
          )
        : Promise.resolve([]),
    ]);
    return {
      ...this.summaryProjection(application, items.length),
      orderId: application.orderId,
      manualReviewReason: application.manualReviewReason,
      reason: application.reason,
      items: items.map((item) => this.itemProjection(item)),
      evidence: evidence.map((row) => this.evidenceProjection(row)),
      rejectionReason: application.rejectionReason,
      returnCarrier: application.returnCarrier,
      returnTrackingNo: application.returnTrackingNo,
      submittedAt: application.submittedAt?.toISOString() ?? null,
      approvedAt: application.approvedAt?.toISOString() ?? null,
      returnedAt: application.returnedAt?.toISOString() ?? null,
      receivedAt: application.receivedAt?.toISOString() ?? null,
      refundProcessingAt: application.refundProcessingAt?.toISOString() ?? null,
      refundedAt: application.refundedAt?.toISOString() ?? null,
      version: application.version,
    };
  }

  private async adminDetailProjection(
    em: EntityManager,
    application: ReturnRefundApplication,
  ): Promise<AdminReturnRefundDetail> {
    const [detail, events] = await Promise.all([
      this.detailProjection(em, application),
      em.find(
        ReturnRefundEvent,
        { applicationId: application.id },
        { orderBy: [{ createdAt: 'ASC' }, { id: 'ASC' }] },
      ),
    ]);
    return {
      ...detail,
      userId: application.userId,
      events: events.map((event) => ({
        action: event.action,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        actorRole: event.actorRole,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  private async chatDraftProjection(
    em: EntityManager,
    application: ReturnRefundApplication,
  ): Promise<ReturnRefundChatDraftResult> {
    const items = await em.find(
      ReturnRefundItem,
      { applicationId: application.id },
      { orderBy: { id: 'ASC' } },
    );
    return {
      applicationId: application.id,
      orderNo: application.orderNo,
      status: ReturnRefundStatus.PENDING_USER_SUBMISSION,
      currency: application.currency,
      refundAmount: application.refundAmount,
      items: items.map((item) => ({
        productName: item.productName,
        color: item.color,
        size: item.size,
        quantity: item.quantity,
      })),
    };
  }

  private async itemCountsFor(
    applications: ReturnRefundApplication[],
  ): Promise<Map<string, number>> {
    if (!applications.length) return new Map();
    const rows = await this.applicationItems.find({
      applicationId: { $in: applications.map((application) => application.id) },
    });
    const counts = new Map<string, number>();
    for (const row of rows)
      counts.set(
        row.applicationId,
        (counts.get(row.applicationId) ?? 0) + row.quantity,
      );
    return counts;
  }

  private summaryProjection(
    application: ReturnRefundApplication,
    itemCount = 0,
  ): ReturnRefundSummary {
    return {
      id: application.id,
      orderNo: application.orderNo,
      status: application.status,
      manualReviewRequired: application.manualReviewRequired,
      refundAmount: application.refundAmount,
      currency: application.currency,
      itemCount,
      createdAt: application.createdAt.toISOString(),
      updatedAt: application.updatedAt.toISOString(),
    };
  }

  private itemProjection(item: ReturnRefundItem): ReturnRefundItemDto {
    return {
      orderItemId: item.orderItemId,
      productName: item.productName,
      productExternalId: item.productExternalId,
      color: item.color,
      size: item.size,
      imageUrl: item.imageUrl,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineAmount: item.lineAmount,
    };
  }

  private evidenceProjection(
    evidence: ReturnRefundEvidence,
  ): ReturnRefundEvidenceDto {
    return {
      id: evidence.id,
      mediaType: evidence.mediaType as ReturnRefundEvidenceDto['mediaType'],
      byteSize: evidence.byteSize,
      createdAt: evidence.createdAt.toISOString(),
    };
  }

  private recordEvent(
    em: EntityManager,
    application: ReturnRefundApplication,
    action: string,
    fromStatus: ReturnRefundStatus | null,
    actorUserId: string | null,
    actorRole: 'user' | 'admin',
  ): void {
    em.create(ReturnRefundEvent, {
      applicationId: application.id,
      action,
      fromStatus,
      toStatus: application.status,
      actorUserId,
      actorRole,
      createdAt: application.updatedAt,
    });
  }

  private normalizeInput(input: CreateReturnRefundDraftInput) {
    if (!uuidPattern.test(input.orderId))
      throw new BadRequestException('订单标识无效');
    const items = [...input.items]
      .map((item) => {
        if (!uuidPattern.test(item.orderItemId))
          throw new BadRequestException('订单商品标识无效');
        if (!Number.isSafeInteger(item.quantity) || item.quantity < 1)
          throw new BadRequestException('申请数量无效');
        return { orderItemId: item.orderItemId, quantity: item.quantity };
      })
      .sort((left, right) => left.orderItemId.localeCompare(right.orderItemId));
    if (!items.length || items.length > 50)
      throw new BadRequestException('申请商品数量无效');
    if (new Set(items.map((item) => item.orderItemId)).size !== items.length)
      throw new BadRequestException('申请商品不能重复');
    const reason = input.reason.trim();
    if (
      !reason ||
      reason.length > 1000 ||
      /[\u0000-\u001f\u007f]/u.test(reason)
    )
      throw new BadRequestException('退货原因无效');
    return { orderId: input.orderId, items, reason };
  }

  private requestHash(
    path: 'chat_draft' | 'direct_submit',
    input: ReturnType<ReturnRefundService['normalizeInput']>,
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          path,
          orderId: input.orderId,
          items: input.items,
          reason: input.reason,
        }),
      )
      .digest('hex');
  }

  private assertUuid(value: string): void {
    if (!uuidPattern.test(value)) throw new BadRequestException('标识无效');
  }

  private toMinorUnits(value: string): bigint {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(value);
    if (!match) throw new ConflictException('订单金额快照无效');
    return BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  }

  private formatMinorUnits(amount: bigint): string {
    return `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
  }

  private async databaseNow(em: EntityManager): Promise<Date> {
    const rows = await em
      .getConnection()
      .execute<Array<{ now: Date | string }>>(
        'select clock_timestamp() as now',
        [],
        'all',
        em.getTransactionContext(),
      );
    const value = rows[0]?.now;
    const now = value instanceof Date ? value : new Date(value ?? '');
    if (!Number.isFinite(now.getTime()))
      throw new ServiceUnavailableException('售后服务暂不可用');
    return now;
  }

  private manager(): EntityManager {
    return this.applications.getEntityManager().fork();
  }
}
