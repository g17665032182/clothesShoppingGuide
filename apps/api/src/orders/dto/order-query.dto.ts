import { ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

import { OrderStatus } from '../entity/order.entity.js';

const orderStatuses = Object.values(OrderStatus) as [
  OrderStatus,
  ...OrderStatus[],
];
const pageSchema = z.coerce.number().int().safe().min(1).default(1);
const pageSizeSchema = z.coerce
  .number()
  .int()
  .safe()
  .min(1)
  .max(100)
  .default(20);
const statusSchema = z.enum(orderStatuses).optional();
const orderNoSchema = z.string().trim().min(1).max(100);

export class CustomerOrderQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, default: 1 })
  public page = 1;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  public pageSize = 20;

  @ApiPropertyOptional({ enum: orderStatuses })
  public status?: OrderStatus;

  @ApiPropertyOptional({ minLength: 1, maxLength: 100 })
  public orderNo?: string;
}

export class AdminOrderQueryDto extends CustomerOrderQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  public userId?: string;
}

export const customerOrderQuerySchema = z
  .strictObject({
    page: pageSchema,
    pageSize: pageSizeSchema,
    status: statusSchema,
    orderNo: orderNoSchema.optional(),
  })
  .transform((input) => Object.assign(new CustomerOrderQueryDto(), input));

export const adminOrderQuerySchema = z
  .strictObject({
    page: pageSchema,
    pageSize: pageSizeSchema,
    status: statusSchema,
    orderNo: orderNoSchema.optional(),
    userId: z.uuid().optional(),
  })
  .transform((input) => Object.assign(new AdminOrderQueryDto(), input));

export type CustomerOrderQuery = z.output<typeof customerOrderQuerySchema>;
export type AdminOrderQuery = z.output<typeof adminOrderQuerySchema>;
