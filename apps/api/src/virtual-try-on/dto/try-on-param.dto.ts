import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const tryOnUuidParamSchema = z.strictObject({ id: z.uuid() });
export const emptyTryOnActionSchema = z.strictObject({});

export class TryOnUuidParamDto {
  @ApiProperty({ format: 'uuid' })
  public id!: string;
}
