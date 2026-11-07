import { ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

const categories = [
  'tops',
  'bottoms',
  'dresses',
  'outerwear',
  'shoes',
] as const;
const pageSchema = z.coerce.number().int().safe().min(1).default(1);
const pageSizeSchema = z.coerce
  .number()
  .int()
  .safe()
  .min(1)
  .max(100)
  .default(20);
const safeKeyword = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));

export class AdminProductQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, default: 1 })
  public page = 1;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  public pageSize = 20;

  @ApiPropertyOptional({ maxLength: 160 })
  public keyword?: string;

  @ApiPropertyOptional({ enum: categories })
  public category?: (typeof categories)[number];

  @ApiPropertyOptional({ type: Boolean })
  public isActive?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  public inStock?: boolean;
}

export const adminProductQuerySchema = z
  .strictObject({
    page: pageSchema,
    pageSize: pageSizeSchema,
    keyword: safeKeyword.optional(),
    category: z.enum(categories).optional(),
    isActive: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    inStock: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  })
  .transform((input) => Object.assign(new AdminProductQueryDto(), input));

export type AdminProductQueryInput = z.input<typeof adminProductQuerySchema>;
export type AdminProductQuery = z.output<typeof adminProductQuerySchema>;
