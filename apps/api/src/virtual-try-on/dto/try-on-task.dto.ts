import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { TryOnTaskStatus } from '../entity/try-on-task.entity.js';

const boundedText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\u0000-\u001f\u007f]*$/u);

const page = z.coerce.number().int().safe().min(1).default(1);
const pageSize = z.coerce.number().int().safe().min(1).max(100).default(20);
const statuses = Object.values(TryOnTaskStatus) as [
  TryOnTaskStatus,
  ...TryOnTaskStatus[],
];

export const createTryOnTaskSchema = z.strictObject({
  productExternalId: boundedText(160),
  color: boundedText(32),
  photoId: z.uuid(),
  consentVersion: boundedText(80),
});

export const tryOnTaskQuerySchema = z.strictObject({
  page,
  pageSize,
  status: z.enum(statuses).optional(),
  unread: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) =>
      typeof value === 'boolean' ? value : value === 'true',
    )
    .optional(),
});

export type CreateTryOnTaskInput = z.output<typeof createTryOnTaskSchema>;
export type TryOnTaskQuery = z.output<typeof tryOnTaskQuerySchema>;

export class CreateTryOnTaskDto {
  @ApiProperty({ maxLength: 160 })
  public productExternalId!: string;
  @ApiProperty({ maxLength: 32 })
  public color!: string;
  @ApiProperty({ format: 'uuid' })
  public photoId!: string;
  @ApiProperty({ maxLength: 80 })
  public consentVersion!: string;
}

export class TryOnTaskQueryDto {
  @ApiPropertyOptional({ type: Number, default: 1 })
  public page = 1;
  @ApiPropertyOptional({ type: Number, default: 20 })
  public pageSize = 20;
  @ApiPropertyOptional({ enum: statuses })
  public status?: TryOnTaskStatus;
  @ApiPropertyOptional({ type: Boolean })
  public unread?: boolean;
}
