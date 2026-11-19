import { randomUUID } from 'node:crypto';

import {
  Entity,
  Enum,
  Index,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

export enum ReturnRefundStatus {
  PENDING_USER_SUBMISSION = 'pending_user_submission',
  PENDING_REVIEW = 'pending_review',
  APPROVED_PENDING_RETURN = 'approved_pending_return',
  RETURNED_BY_USER = 'returned_by_user',
  PENDING_INSPECTION = 'pending_inspection',
  REFUND_PROCESSING = 'refund_processing',
  REFUNDED = 'refunded',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

@Entity({ tableName: 'return_refund_applications' })
@Unique({
  name: 'return_refund_applications_user_idempotency_unique',
  properties: ['userId', 'idempotencyKey'],
})
@Index({
  name: 'return_refund_applications_user_created_index',
  properties: ['userId', 'createdAt', 'id'],
})
@Index({
  name: 'return_refund_applications_status_created_index',
  properties: ['status', 'createdAt', 'id'],
})
export class ReturnRefundApplication {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'order_id' })
  public orderId!: string;

  @Property({ type: 'uuid', fieldName: 'user_id' })
  public userId!: string;

  @Property({ type: 'string', fieldName: 'order_no', length: 100 })
  public orderNo!: string;

  @Enum({ items: () => ReturnRefundStatus })
  public status: ReturnRefundStatus =
    ReturnRefundStatus.PENDING_USER_SUBMISSION;

  @Property({ type: 'boolean', fieldName: 'manual_review_required' })
  public manualReviewRequired = false;

  @Property({
    type: 'string',
    fieldName: 'manual_review_reason',
    length: 64,
    nullable: true,
  })
  public manualReviewReason: string | null = null;

  @Property({ type: 'text' })
  public reason!: string;

  @Property({
    type: 'string',
    fieldName: 'rejection_reason',
    length: 1000,
    nullable: true,
  })
  public rejectionReason: string | null = null;

  @Property({
    type: 'decimal',
    fieldName: 'refund_amount',
    precision: 16,
    scale: 2,
  })
  public refundAmount!: string;

  @Property({ type: 'string', length: 3, default: 'CNY' })
  public currency = 'CNY';

  @Property({
    type: 'string',
    fieldName: 'return_carrier',
    length: 100,
    nullable: true,
  })
  public returnCarrier: string | null = null;

  @Property({
    type: 'string',
    fieldName: 'return_tracking_no',
    length: 100,
    nullable: true,
  })
  public returnTrackingNo: string | null = null;

  @Property({ type: 'uuid', fieldName: 'idempotency_key' })
  public idempotencyKey!: string;

  @Property({ type: 'string', fieldName: 'request_hash', length: 64 })
  public requestHash!: string;

  @Property({ type: 'integer', default: 1 })
  public version = 1;

  @Property({
    type: 'timestamptz',
    fieldName: 'submitted_at',
    nullable: true,
  })
  public submittedAt: Date | null = null;

  @Property({
    type: 'timestamptz',
    fieldName: 'approved_at',
    nullable: true,
  })
  public approvedAt: Date | null = null;

  @Property({
    type: 'timestamptz',
    fieldName: 'returned_at',
    nullable: true,
  })
  public returnedAt: Date | null = null;

  @Property({
    type: 'timestamptz',
    fieldName: 'received_at',
    nullable: true,
  })
  public receivedAt: Date | null = null;

  @Property({
    type: 'timestamptz',
    fieldName: 'refund_processing_at',
    nullable: true,
  })
  public refundProcessingAt: Date | null = null;

  @Property({
    type: 'timestamptz',
    fieldName: 'refunded_at',
    nullable: true,
  })
  public refundedAt: Date | null = null;

  @Property({
    type: 'timestamptz',
    fieldName: 'rejected_at',
    nullable: true,
  })
  public rejectedAt: Date | null = null;

  @Property({
    type: 'timestamptz',
    fieldName: 'cancelled_at',
    nullable: true,
  })
  public cancelledAt: Date | null = null;

  @Property({
    type: 'timestamptz',
    fieldName: 'created_at',
    onCreate: () => new Date(),
  })
  public createdAt = new Date();

  @Property({
    type: 'timestamptz',
    fieldName: 'updated_at',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  public updatedAt = new Date();
}
