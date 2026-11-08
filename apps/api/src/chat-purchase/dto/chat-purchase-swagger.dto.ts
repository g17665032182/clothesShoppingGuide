import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderDetailResponseDto } from '../../orders/index.js';

export class PurchaseVersionDto {
  @ApiProperty({ minimum: 1, type: Number }) public expectedVersion!: number;
}
export class PurchaseRecipientDto {
  @ApiProperty({ type: String, nullable: true, maxLength: 100 }) public name!:
    string | null;
  @ApiProperty({ type: String, nullable: true, pattern: '^\\+?\\d{6,20}$' })
  public phone!: string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: 500 })
  public address!: string | null;
}
export class PatchPurchaseDto extends PurchaseVersionDto {
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  public skuId?: string | null;
  @ApiPropertyOptional({ minimum: 1, maximum: 99, type: Number })
  public quantity?: number;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', nullable: true, minLength: 1, maxLength: 100 },
      phone: { type: 'string', nullable: true, pattern: '^\\+?\\d{6,20}$' },
      address: { type: 'string', nullable: true, minLength: 1, maxLength: 500 },
    },
  })
  public recipient?: {
    name?: string | null;
    phone?: string | null;
    address?: string | null;
  };
}
export class PurchaseConfirmationDto {
  @ApiProperty({ minimum: 1 }) public version!: number;
  @ApiProperty() public productExternalId!: string;
  @ApiProperty({ format: 'uuid' }) public skuId!: string;
  @ApiProperty() public name!: string;
  @ApiProperty() public color!: string;
  @ApiProperty() public size!: string;
  @ApiProperty({ type: String, nullable: true }) public imageUrl!:
    string | null;
  @ApiProperty({ minimum: 1, maximum: 99 }) public quantity!: number;
  @ApiProperty() public unitPrice!: string;
  @ApiProperty({ enum: ['CNY'] }) public currency!: string;
  @ApiProperty() public itemsAmount!: string;
  @ApiProperty() public shippingAmount!: string;
  @ApiProperty() public payableAmount!: string;
  @ApiProperty({ type: PurchaseRecipientDto })
  public recipient!: PurchaseRecipientDto;
}
export class PurchaseDraftDto {
  @ApiProperty({ format: 'uuid' }) public id!: string;
  @ApiProperty({ format: 'uuid' }) public conversationId!: string;
  @ApiProperty() public productExternalId!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) public skuId!:
    string | null;
  @ApiProperty({ minimum: 1, maximum: 99 }) public quantity!: number;
  @ApiProperty({ type: PurchaseRecipientDto })
  public recipient!: PurchaseRecipientDto;
  @ApiProperty({
    enum: ['collecting', 'ready', 'submitted', 'cancelled', 'expired'],
  })
  public status!: string;
  @ApiProperty({ minimum: 1 }) public version!: number;
  @ApiProperty({ type: PurchaseConfirmationDto, nullable: true })
  public confirmation!: PurchaseConfirmationDto | null;
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          enum: [
            'missing_field',
            'sku_selection_required',
            'product_unavailable',
            'sku_unavailable',
            'insufficient_stock',
            'price_changed',
            'specification_changed',
            'expired',
          ],
        },
        field: {
          type: 'string',
          enum: ['recipient.name', 'recipient.phone', 'recipient.address'],
        },
      },
      required: ['code'],
      additionalProperties: false,
    },
  })
  public issues!: Array<{ code: string; field?: string }>;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  public orderId!: string | null;
  @ApiProperty({ format: 'date-time' }) public createdAt!: string;
  @ApiProperty({ format: 'date-time' }) public updatedAt!: string;
  @ApiProperty({ format: 'date-time' }) public expiresAt!: string;
}
export class PurchaseStateDto {
  @ApiProperty({ type: PurchaseDraftDto, nullable: true })
  public draft!: PurchaseDraftDto | null;
  @ApiProperty({ type: OrderDetailResponseDto, nullable: true })
  public order!: OrderDetailResponseDto | null;
}
