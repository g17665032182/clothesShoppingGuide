import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorator/current-user.decorator.js';
import {
  createAndSubmitReturnRefundSchema,
  emptyReturnRefundActionSchema,
  returnRefundApplicationIdSchema,
  returnRefundOrderIdSchema,
  returnRefundShipmentSchema,
  returnRefundUserQuerySchema,
  submitReturnRefundSchema,
  type CreateAndSubmitReturnRefundInput,
  type ReturnRefundApplicationIdInput,
  type ReturnRefundOrderIdInput,
  type ReturnRefundShipmentInput,
  type ReturnRefundUserQuery,
  type SubmitReturnRefundInput,
} from '../dto/return-refund.schema.js';
import type { ReturnRefundDetail } from '../dto/return-refund-response.dto.js';
import { ReturnRefundQueryService } from '../service/return-refund-query.service.js';
import { ReturnRefundService } from '../service/return-refund.service.js';

@Controller()
@ApiBearerAuth('bearer')
@ApiTags('本人退货退款申请')
export class ReturnRefundController {
  public constructor(
    private readonly refunds: ReturnRefundService,
    private readonly queryService: ReturnRefundQueryService,
  ) {}

  @Get('orders/:orderId/return-refund-options')
  @ApiOkResponse({ type: Object })
  @ApiNotFoundResponse({ description: '订单不存在或不属于当前用户' })
  public options(
    @CurrentUser() user: { id: string },
    @Param({ schema: returnRefundOrderIdSchema })
    params: ReturnRefundOrderIdInput,
  ) {
    return this.queryService.getOptionsForUser(user.id, params.orderId);
  }

  @Post('orders/:orderId/return-refund-applications')
  @ApiCreatedResponse({ type: Object })
  @ApiConflictResponse({ description: '订单已有未结束申请或申请数量冲突' })
  public createAndSubmit(
    @CurrentUser() user: { id: string },
    @Param({ schema: returnRefundOrderIdSchema })
    params: ReturnRefundOrderIdInput,
    @Body({ schema: createAndSubmitReturnRefundSchema })
    body: CreateAndSubmitReturnRefundInput,
  ): Promise<ReturnRefundDetail> {
    return this.refunds.createAndSubmitForUser(
      user.id,
      params.orderId,
      body,
      body.idempotencyKey,
    );
  }

  @Get('return-refund-applications')
  @ApiOkResponse({ type: Object })
  public list(
    @CurrentUser() user: { id: string },
    @Query({ schema: returnRefundUserQuerySchema })
    query: ReturnRefundUserQuery,
  ) {
    return this.queryService.listForUser(user.id, query);
  }

  @Get('return-refund-applications/:id')
  @ApiOkResponse({ type: Object })
  @ApiNotFoundResponse({ description: '售后申请不存在' })
  public get(
    @CurrentUser() user: { id: string },
    @Param({ schema: returnRefundApplicationIdSchema })
    params: ReturnRefundApplicationIdInput,
  ): Promise<ReturnRefundDetail> {
    return this.queryService.getForUser(user.id, params.id);
  }

  @Post('return-refund-applications/:id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: Object })
  @ApiConflictResponse({ description: '申请已更新或当前状态不能提交' })
  public submit(
    @CurrentUser() user: { id: string },
    @Param({ schema: returnRefundApplicationIdSchema })
    params: ReturnRefundApplicationIdInput,
    @Body({ schema: submitReturnRefundSchema }) body: SubmitReturnRefundInput,
  ): Promise<ReturnRefundDetail> {
    return this.refunds.submitDraft(user.id, params.id, body);
  }

  @Post('return-refund-applications/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: Object })
  @ApiConflictResponse({ description: '申请当前状态不能取消' })
  public cancel(
    @CurrentUser() user: { id: string },
    @Param({ schema: returnRefundApplicationIdSchema })
    params: ReturnRefundApplicationIdInput,
    @Body({ schema: emptyReturnRefundActionSchema })
    _body: Record<string, never>,
  ): Promise<ReturnRefundDetail> {
    return this.refunds.cancelForUser(user.id, params.id);
  }

  @Post('return-refund-applications/:id/return-shipment')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: Object })
  @ApiConflictResponse({ description: '申请当前状态不能登记退货物流' })
  public setReturnShipment(
    @CurrentUser() user: { id: string },
    @Param({ schema: returnRefundApplicationIdSchema })
    params: ReturnRefundApplicationIdInput,
    @Body({ schema: returnRefundShipmentSchema })
    body: ReturnRefundShipmentInput,
  ): Promise<ReturnRefundDetail> {
    return this.refunds.setReturnShipmentForUser(user.id, params.id, body);
  }
}
