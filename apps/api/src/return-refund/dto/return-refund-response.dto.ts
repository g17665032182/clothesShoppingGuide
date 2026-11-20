import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ReturnRefundStatus } from '../entity/return-refund-application.entity.js';

export type ReturnRefundItemDto = {
  orderItemId: string;
  productName: string;
  productExternalId: string;
  color: string;
  size: string;
  imageUrl: string | null;
  quantity: number;
  unitPrice: string;
  lineAmount: string;
};

export type ReturnRefundEventDto = {
  action: string;
  fromStatus: string | null;
  toStatus: string;
  actorRole: string;
  createdAt: string;
};

export type ReturnRefundEvidenceDto = {
  id: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4';
  byteSize: number;
  createdAt: string;
};

export type ReturnRefundSummary = {
  id: string;
  orderNo: string;
  status: ReturnRefundStatus;
  manualReviewRequired: boolean;
  refundAmount: string;
  currency: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ReturnRefundDetail = ReturnRefundSummary & {
  orderId: string;
  manualReviewReason: string | null;
  reason: string;
  items: ReturnRefundItemDto[];
  evidence: ReturnRefundEvidenceDto[];
  rejectionReason: string | null;
  returnCarrier: string | null;
  returnTrackingNo: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  returnedAt: string | null;
  receivedAt: string | null;
  refundProcessingAt: string | null;
  refundedAt: string | null;
  version: number;
};

export type AdminReturnRefundDetail = ReturnRefundDetail & {
  userId: string;
  events: ReturnRefundEventDto[];
};

export type ReturnRefundPage<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type ReturnRefundOrderOptions = {
  orderId: string;
  orderNo: string;
  status: string;
  completedAt: string | null;
  currency: string;
  items: Array<{
    orderItemId: string;
    productName: string;
    productExternalId: string;
    color: string;
    size: string;
    imageUrl: string | null;
    unitPrice: string;
    quantity: number;
    availableQuantity: number;
  }>;
};

export type ChatOrderCandidate = {
  id: string;
  orderNo: string;
  status: string;
  completedAt: string | null;
  currency: string;
  itemCount: number;
};

export type ChatOrderOptions = ReturnRefundOrderOptions;

export type ReturnRefundChatDraftResult = {
  applicationId: string;
  orderNo: string;
  status: ReturnRefundStatus.PENDING_USER_SUBMISSION;
  currency: string;
  refundAmount: string;
  items: Array<{
    productName: string;
    color: string;
    size: string;
    quantity: number;
  }>;
};

export class ReturnRefundPageResponseDto {
  @ApiProperty({ type: [Object] })
  public items!: ReturnRefundSummary[];

  @ApiProperty({ minimum: 0 })
  public total!: number;

  @ApiProperty({ minimum: 1 })
  public page!: number;

  @ApiProperty({ minimum: 1, maximum: 100 })
  public pageSize!: number;
}

export class ReturnRefundItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  public orderItemId!: string;

  @ApiProperty()
  public productName!: string;

  @ApiProperty()
  public productExternalId!: string;

  @ApiProperty()
  public color!: string;

  @ApiProperty()
  public size!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  public imageUrl!: string | null;

  @ApiProperty({ minimum: 1 })
  public quantity!: number;

  @ApiProperty({ type: String, pattern: '^\\d+\\.\\d{2}$' })
  public unitPrice!: string;

  @ApiProperty({ type: String, pattern: '^\\d+\\.\\d{2}$' })
  public lineAmount!: string;
}
