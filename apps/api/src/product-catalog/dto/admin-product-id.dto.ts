import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export class AdminProductIdDto {
  @ApiProperty({ format: 'uuid' })
  public id!: string;
}

export const adminProductIdSchema = z
  .strictObject({ id: z.uuid() })
  .transform((input) => Object.assign(new AdminProductIdDto(), input));

export type AdminProductId = z.output<typeof adminProductIdSchema>;
