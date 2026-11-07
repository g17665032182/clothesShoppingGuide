import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../../authorization/decorator/roles.decorator.js';
import { RolesGuard } from '../../authorization/guard/roles.guard.js';
import { UserRole } from '../../users/entity/user.entity.js';
import { OrderIdDto, orderIdSchema } from '../dto/order-id.dto.js';
import {
  AdminOrderQueryDto,
  adminOrderQuerySchema,
} from '../dto/order-query.dto.js';
import {
  AdminOrderDetailResponseDto,
  AdminOrderPageResponseDto,
} from '../dto/order-response.dto.js';
import { ShipOrderDto, shipOrderSchema } from '../dto/ship-order.dto.js';
import { OrdersService } from '../service/orders.service.js';

@Controller('admin/orders')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth('bearer')
@ApiTags('管理员订单')
export class AdminOrdersController {
  public constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
  ) {}

  @Get()
  @ApiOkResponse({ type: AdminOrderPageResponseDto })
  @ApiForbiddenResponse({ description: '仅管理员可访问' })
  public list(
    @Query({ schema: adminOrderQuerySchema }) query: AdminOrderQueryDto,
  ) {
    return this.orders.listForAdmin(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: AdminOrderDetailResponseDto })
  @ApiForbiddenResponse({ description: '仅管理员可访问' })
  @ApiNotFoundResponse({ description: '订单不存在' })
  public get(@Param({ schema: orderIdSchema }) input: OrderIdDto) {
    return this.orders.getForAdmin(input.id);
  }

  @Post(':id/ship')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AdminOrderDetailResponseDto })
  @ApiForbiddenResponse({ description: '仅管理员可访问' })
  @ApiConflictResponse({ description: '订单状态不允许发货或物流信息冲突' })
  public ship(
    @Param({ schema: orderIdSchema }) input: OrderIdDto,
    @Body({ schema: shipOrderSchema }) body: ShipOrderDto,
  ) {
    return this.orders.shipForAdmin(input.id, body);
  }
}
