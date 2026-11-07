import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

const noControlCharacters = (value: string) =>
  !/[\u0000-\u001f\u007f]/u.test(value);

export class ShipOrderDto {
  @ApiProperty({ minLength: 1, maxLength: 100 })
  public carrier!: string;

  @ApiProperty({ minLength: 1, maxLength: 100 })
  public trackingNo!: string;
}

export class EmptyOrderActionDto {}

export const shipOrderSchema = z
  .strictObject({
    carrier: z.string().trim().min(1).max(100).refine(noControlCharacters),
    trackingNo: z.string().trim().min(1).max(100).refine(noControlCharacters),
  })
  .transform((input) => Object.assign(new ShipOrderDto(), input));

export const emptyOrderActionSchema = z.strictObject({});

export type ShipOrderInput = z.output<typeof shipOrderSchema>;
export type EmptyOrderActionInput = z.output<typeof emptyOrderActionSchema>;
