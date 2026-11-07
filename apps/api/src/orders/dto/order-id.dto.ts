import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export class OrderIdDto {
  @ApiProperty({ format: 'uuid' })
  public id!: string;
}

export const orderIdSchema = z
  .strictObject({ id: z.uuid() })
  .transform((input) => Object.assign(new OrderIdDto(), input));

export type OrderIdInput = z.output<typeof orderIdSchema>;
