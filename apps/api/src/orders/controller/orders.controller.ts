import {
  Body,
  Controller,
  Get,
  Inject,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorator/current-user.decorator.js';
import type { User } from '../../users/entity/user.entity.js';
import { CreateOrderDto, createOrderSchema } from '../dto/create-order.dto.js';
import { OrderIdDto, orderIdSchema } from '../dto/order-id.dto.js';
import {
  CustomerOrderQueryDto,
  customerOrderQuerySchema,
} from '../dto/order-query.dto.js';
import {
  OrderDetailResponseDto,
  OrderPageResponseDto,
} from '../dto/order-response.dto.js';
import {
  EmptyOrderActionDto,
  emptyOrderActionSchema,
} from '../dto/ship-order.dto.js';
import { OrdersService } from '../service/orders.service.js';

@Controller('orders')
@ApiBearerAuth('bearer')
@ApiTags('订单')
export class OrdersController {
  public constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
  ) {}

  @Post()
  @ApiCreatedResponse({ type: OrderDetailResponseDto })
  @ApiOkResponse({ type: OrderDetailResponseDto, description: '幂等重试' })
  @ApiBadRequestResponse({ description: '请求内容不符合订单契约' })
  @ApiConflictResponse({ description: '库存不足或幂等键内容冲突' })
  public async create(
    @CurrentUser() user: User,
    @Body({ schema: createOrderSchema }) input: CreateOrderDto,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<OrderDetailResponseDto> {
    const result = await this.orders.createForUser(user.id, input);
    response.statusCode = result.created ? HttpStatus.CREATED : HttpStatus.OK;
    return result.order;
  }

  @Get()
  @ApiOkResponse({ type: OrderPageResponseDto })
  public list(
    @CurrentUser() user: User,
    @Query({ schema: customerOrderQuerySchema })
    query: CustomerOrderQueryDto,
  ) {
    return this.orders.listForUser(user.id, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: OrderDetailResponseDto })
  @ApiNotFoundResponse({ description: '订单不存在或不属于当前用户' })
  public get(
    @CurrentUser() user: User,
    @Param({ schema: orderIdSchema }) input: OrderIdDto,
  ) {
    return this.orders.getForUser(user.id, input.id);
  }

  @Post(':id/simulate-payment')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: OrderDetailResponseDto })
  @ApiConflictResponse({ description: '订单已过期或不能支付' })
  public simulatePayment(
    @CurrentUser() user: User,
    @Param({ schema: orderIdSchema }) input: OrderIdDto,
    @Body({ schema: emptyOrderActionSchema }) _body: EmptyOrderActionDto,
  ) {
    return this.orders.simulatePayment(user.id, input.id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: OrderDetailResponseDto })
  @ApiConflictResponse({ description: '订单已关闭或不能取消' })
  public cancel(
    @CurrentUser() user: User,
    @Param({ schema: orderIdSchema }) input: OrderIdDto,
    @Body({ schema: emptyOrderActionSchema }) _body: EmptyOrderActionDto,
  ) {
    return this.orders.cancelForUser(user.id, input.id);
  }

  @Post(':id/confirm-receipt')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: OrderDetailResponseDto })
  @ApiConflictResponse({ description: '订单尚未发货或已完成' })
  public confirmReceipt(
    @CurrentUser() user: User,
    @Param({ schema: orderIdSchema }) input: OrderIdDto,
    @Body({ schema: emptyOrderActionSchema }) _body: EmptyOrderActionDto,
  ) {
    return this.orders.confirmReceiptForUser(user.id, input.id);
  }
}
