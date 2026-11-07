import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

const noControlCharacters = (value: string) =>
  !/[\u0000-\u001f\u007f]/u.test(value);

export class CreateOrderDto {
  @ApiProperty({ format: 'uuid' })
  public idempotencyKey!: string;

  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        skuId: { type: 'string', format: 'uuid' },
        quantity: { type: 'integer', minimum: 1, maximum: 99 },
      },
      required: ['skuId', 'quantity'],
    },
  })
  public items!: Array<{ skuId: string; quantity: number }>;

  @ApiProperty({
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
      phone: { type: 'string', pattern: '^\\+?[0-9]{6,20}$' },
      address: { type: 'string', minLength: 1, maxLength: 500 },
    },
    required: ['name', 'phone', 'address'],
  })
  public recipient!: {
    name: string;
    phone: string;
    address: string;
  };
}

export const createOrderSchema = z
  .strictObject({
    idempotencyKey: z.uuid(),
    items: z
      .array(
        z.strictObject({
          skuId: z.uuid(),
          quantity: z.number().int().min(1).max(99),
        }),
      )
      .min(1)
      .max(50)
      .refine(
        (items) =>
          new Set(items.map((item) => item.skuId)).size === items.length,
        '同一订单不能重复选择相同 SKU',
      ),
    recipient: z.strictObject({
      name: z.string().trim().min(1).max(100).refine(noControlCharacters),
      phone: z
        .string()
        .trim()
        .regex(/^\+?\d{6,20}$/u, '手机号格式不正确'),
      address: z.string().trim().min(1).max(500).refine(noControlCharacters),
    }),
  })
  .transform((input) => Object.assign(new CreateOrderDto(), input));

export type CreateOrderInput = z.output<typeof createOrderSchema>;
