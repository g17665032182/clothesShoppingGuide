import { randomUUID } from 'node:crypto';

import {
  Entity,
  Enum,
  Index,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

export enum OrderStatus {
  PENDING_PAYMENT = 'pending_payment',
  PENDING_SHIPMENT = 'pending_shipment',
  PENDING_RECEIPT = 'pending_receipt',
  COMPLETED = 'completed',
  CLOSED = 'closed',
}

export enum OrderCloseReason {
  USER_CANCELLED = 'user_cancelled',
  PAYMENT_EXPIRED = 'payment_expired',
  PRODUCT_UNAVAILABLE = 'product_unavailable',
}

@Entity({ tableName: 'orders' })
@Unique({ name: 'orders_order_no_unique', properties: ['orderNo'] })
@Index({
  name: 'orders_user_created_index',
  properties: ['userId', 'createdAt', 'id'],
})
@Index({
  name: 'orders_status_created_index',
  properties: ['status', 'createdAt', 'id'],
})
export class Order {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'string', fieldName: 'order_no', length: 100 })
  public orderNo!: string;

  @Property({ type: 'uuid', fieldName: 'user_id' })
  public userId!: string;

  @Enum({ items: () => OrderStatus })
  public status: OrderStatus = OrderStatus.PENDING_PAYMENT;

  @Enum({
    items: () => OrderCloseReason,
    fieldName: 'close_reason',
    nullable: true,
  })
  public closeReason: OrderCloseReason | null = null;

  @Property({ type: 'string', length: 3, default: 'CNY' })
  public currency = 'CNY';

  @Property({
    type: 'decimal',
    fieldName: 'items_amount',
    precision: 16,
    scale: 2,
  })
  public itemsAmount!: string;

  @Property({
    type: 'decimal',
    fieldName: 'shipping_amount',
    precision: 16,
    scale: 2,
    default: '0.00',
  })
  public shippingAmount = '0.00';

  @Property({
    type: 'decimal',
    fieldName: 'discount_amount',
    precision: 16,
    scale: 2,
    default: '0.00',
  })
  public discountAmount = '0.00';

  @Property({
    type: 'decimal',
    fieldName: 'payable_amount',
    precision: 16,
    scale: 2,
  })
  public payableAmount!: string;

  @Property({
    type: 'string',
    fieldName: 'payment_mode',
    length: 16,
    default: 'simulated',
  })
  public paymentMode = 'simulated';

  @Property({ type: 'string', fieldName: 'recipient_name', length: 100 })
  public recipientName!: string;

  @Property({ type: 'string', fieldName: 'recipient_phone', length: 21 })
  public recipientPhone!: string;

  @Property({ type: 'string', fieldName: 'recipient_address', length: 500 })
  public recipientAddress!: string;

  @Property({
    type: 'string',
    fieldName: 'shipment_carrier',
    length: 100,
    nullable: true,
  })
  public shipmentCarrier: string | null = null;

  @Property({
    type: 'string',
    fieldName: 'shipment_tracking_no',
    length: 100,
    nullable: true,
  })
  public shipmentTrackingNo: string | null = null;

  @Property({ type: 'timestamptz', fieldName: 'expires_at' })
  public expiresAt!: Date;

  @Property({
    type: 'timestamptz',
    fieldName: 'paid_at',
    nullable: true,
  })
  public paidAt: Date | null = null;

  @Property({
    type: 'timestamptz',
    fieldName: 'shipped_at',
    nullable: true,
  })
  public shippedAt: Date | null = null;

  @Property({
    type: 'timestamptz',
    fieldName: 'completed_at',
    nullable: true,
  })
  public completedAt: Date | null = null;

  @Property({
    type: 'timestamptz',
    fieldName: 'closed_at',
    nullable: true,
  })
  public closedAt: Date | null = null;

  @Property({
    type: 'timestamptz',
    fieldName: 'created_at',
    onCreate: () => new Date(),
  })
  public createdAt: Date = new Date();

  @Property({
    type: 'timestamptz',
    fieldName: 'updated_at',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  public updatedAt: Date = new Date();
}
