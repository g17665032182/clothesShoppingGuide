import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { OrderCloseReason, OrderStatus } from '../entity/order.entity.js';

export class OrderItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  public skuId!: string;

  @ApiProperty()
  public productExternalId!: string;

  @ApiProperty()
  public productName!: string;

  @ApiProperty()
  public color!: string;

  @ApiProperty()
  public size!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  public imageUrl!: string | null;

  @ApiProperty({ type: String, pattern: '^\\d+\\.\\d{2}$' })
  public unitPrice!: string;

  @ApiProperty({ minimum: 1 })
  public quantity!: number;

  @ApiProperty({ type: String, pattern: '^\\d+\\.\\d{2}$' })
  public lineAmount!: string;
}

export class OrderSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  public id!: string;

  @ApiProperty()
  public orderNo!: string;

  @ApiProperty({ enum: OrderStatus })
  public status!: OrderStatus;

  @ApiPropertyOptional({ enum: OrderCloseReason, nullable: true })
  public closeReason!: OrderCloseReason | null;

  @ApiProperty({ type: String, pattern: '^\\d+\\.\\d{2}$' })
  public itemsAmount!: string;

  @ApiProperty({ type: String, pattern: '^\\d+\\.\\d{2}$' })
  public shippingAmount!: string;

  @ApiProperty({ type: String, pattern: '^\\d+\\.\\d{2}$' })
  public discountAmount!: string;

  @ApiProperty({ type: String, pattern: '^\\d+\\.\\d{2}$' })
  public payableAmount!: string;

  @ApiProperty({ enum: ['CNY'] })
  public currency!: 'CNY';

  @ApiProperty({ enum: ['simulated'] })
  public paymentMode!: 'simulated';

  @ApiProperty({ minimum: 1 })
  public itemCount!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  public expiresAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  public createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  public paidAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  public shippedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  public completedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  public closedAt!: string | null;
}

export class AdminOrderSummaryResponseDto extends OrderSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  public userId!: string;
}

export class OrderDetailResponseDto extends OrderSummaryResponseDto {
  @ApiProperty({ type: [OrderItemResponseDto] })
  public items!: OrderItemResponseDto[];

  @ApiProperty({
    type: 'object',
    properties: {
      name: { type: 'string' },
      phone: { type: 'string' },
      address: { type: 'string' },
    },
  })
  public recipient!: { name: string; phone: string; address: string };

  @ApiProperty({
    type: 'object',
    nullable: true,
    properties: {
      carrier: { type: 'string' },
      trackingNo: { type: 'string' },
    },
  })
  public shipment!: { carrier: string; trackingNo: string } | null;
}

export class AdminOrderDetailResponseDto extends OrderDetailResponseDto {
  @ApiProperty({ format: 'uuid' })
  public userId!: string;
}

export class OrderPageResponseDto {
  @ApiProperty({ type: [OrderSummaryResponseDto] })
  public items!: OrderSummaryResponseDto[];

  @ApiProperty({ minimum: 0 })
  public total!: number;

  @ApiProperty({ minimum: 1 })
  public page!: number;

  @ApiProperty({ minimum: 1, maximum: 100 })
  public pageSize!: number;
}

export class AdminOrderPageResponseDto extends OrderPageResponseDto {
  @ApiProperty({ type: [AdminOrderSummaryResponseDto] })
  declare public items: AdminOrderSummaryResponseDto[];
}
