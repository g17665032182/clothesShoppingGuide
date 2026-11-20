import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../../authorization/decorator/roles.decorator.js';
import { RolesGuard } from '../../authorization/guard/roles.guard.js';
import { CurrentUser } from '../../auth/decorator/current-user.decorator.js';
import { UserRole } from '../../users/entity/user.entity.js';
import {
  adminReturnRefundQuerySchema,
  rejectReturnRefundSchema,
  returnRefundApplicationIdSchema,
  returnRefundVersionSchema,
  type AdminReturnRefundQuery,
  type RejectReturnRefundInput,
  type ReturnRefundApplicationIdInput,
  type ReturnRefundVersionInput,
} from '../dto/return-refund.schema.js';
import type { AdminReturnRefundDetail } from '../dto/return-refund-response.dto.js';
import { ReturnRefundQueryService } from '../service/return-refund-query.service.js';
import { ReturnRefundService } from '../service/return-refund.service.js';

@Controller('admin/return-refund-applications')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth('bearer')
@ApiTags('管理员退货退款申请')
@ApiForbiddenResponse({ description: '仅管理员可访问' })
export class AdminReturnRefundController {
  public constructor(
    private readonly refunds: ReturnRefundService,
    private readonly queryService: ReturnRefundQueryService,
  ) {}

  @Get()
  @ApiOkResponse({ type: Object })
  public list(
    @Query({ schema: adminReturnRefundQuerySchema })
    query: AdminReturnRefundQuery,
  ) {
    return this.queryService.listForAdmin(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: Object })
  public get(
    @Param({ schema: returnRefundApplicationIdSchema })
    params: ReturnRefundApplicationIdInput,
  ): Promise<AdminReturnRefundDetail> {
    return this.queryService.getForAdmin(params.id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: Object })
  @ApiConflictResponse({ description: '申请当前状态不能审核通过' })
  public approve(
    @CurrentUser() admin: { id: string },
    @Param({ schema: returnRefundApplicationIdSchema })
    params: ReturnRefundApplicationIdInput,
    @Body({ schema: returnRefundVersionSchema })
    body: ReturnRefundVersionInput,
  ): Promise<AdminReturnRefundDetail> {
    return this.refunds.approveForAdmin(admin.id, params.id, body.version);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: Object })
  @ApiConflictResponse({ description: '申请当前状态不能拒绝' })
  public reject(
    @CurrentUser() admin: { id: string },
    @Param({ schema: returnRefundApplicationIdSchema })
    params: ReturnRefundApplicationIdInput,
    @Body({ schema: rejectReturnRefundSchema }) body: RejectReturnRefundInput,
  ): Promise<AdminReturnRefundDetail> {
    return this.refunds.rejectForAdmin(admin.id, params.id, body);
  }

  @Post(':id/received')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: Object })
  @ApiConflictResponse({ description: '申请当前状态不能确认收货' })
  public received(
    @CurrentUser() admin: { id: string },
    @Param({ schema: returnRefundApplicationIdSchema })
    params: ReturnRefundApplicationIdInput,
    @Body({ schema: returnRefundVersionSchema })
    body: ReturnRefundVersionInput,
  ): Promise<AdminReturnRefundDetail> {
    return this.refunds.confirmReceivedForAdmin(
      admin.id,
      params.id,
      body.version,
    );
  }

  @Post(':id/refund-processing')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: Object })
  @ApiConflictResponse({ description: '申请当前状态不能进入退款处理中' })
  public refundProcessing(
    @CurrentUser() admin: { id: string },
    @Param({ schema: returnRefundApplicationIdSchema })
    params: ReturnRefundApplicationIdInput,
    @Body({ schema: returnRefundVersionSchema })
    body: ReturnRefundVersionInput,
  ): Promise<AdminReturnRefundDetail> {
    return this.refunds.startRefundForAdmin(admin.id, params.id, body.version);
  }

  @Post(':id/refunded')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: Object })
  @ApiConflictResponse({ description: '申请当前状态不能登记退款完成' })
  public refunded(
    @CurrentUser() admin: { id: string },
    @Param({ schema: returnRefundApplicationIdSchema })
    params: ReturnRefundApplicationIdInput,
    @Body({ schema: returnRefundVersionSchema })
    body: ReturnRefundVersionInput,
  ): Promise<AdminReturnRefundDetail> {
    return this.refunds.markRefundedForAdmin(admin.id, params.id, body.version);
  }
}
