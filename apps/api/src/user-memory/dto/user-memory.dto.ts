import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

import {
  memoryCategorySchema,
  memoryValueByCategorySchema,
  parseMemoryValue,
  type MemoryCategory,
  type MemoryValue,
} from '../context/memory-value.schema.js';

export class ListMemoryQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  public page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  public pageSize = 20;

  @ApiPropertyOptional({ enum: memoryCategorySchema.options })
  public category?: MemoryCategory;
}

export const listMemoryQuerySchema = z
  .strictObject({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    category: memoryCategorySchema.optional(),
  })
  .transform((input) => Object.assign(new ListMemoryQueryDto(), input));

const createMemoryVariant = (category: MemoryCategory) => {
  const valueSchema = memoryValueByCategorySchema.options.find(
    (option) => option.shape.category.value === category,
  )!.shape.value;
  return z.strictObject({
    category: z.literal(category),
    value: valueSchema,
    isPrimary: z.boolean().default(false),
  });
};

export const createMemorySchema = z.discriminatedUnion('category', [
  createMemoryVariant('size'),
  createMemoryVariant('shoe_size'),
  createMemoryVariant('fit'),
  createMemoryVariant('style'),
  createMemoryVariant('color'),
  createMemoryVariant('occasion'),
  createMemoryVariant('budget'),
  createMemoryVariant('avoidance'),
  createMemoryVariant('purchase_preference'),
]);

export type CreateMemoryInput = z.output<typeof createMemorySchema>;
export type CreateMemoryRequest = z.input<typeof createMemorySchema>;

export const updateMemoryParamSchema = z.uuid();
export const updateMemorySchema = z
  .strictObject({
    category: memoryCategorySchema.optional(),
    value: z.unknown().optional(),
    isPrimary: z.boolean().optional(),
  })
  .refine(
    ({ category, value, isPrimary }) =>
      category !== undefined || value !== undefined || isPrimary !== undefined,
    '至少提供一个可更新字段',
  );
export type UpdateMemoryInput = z.output<typeof updateMemorySchema>;

export const deleteAllMemorySchema = z.strictObject({
  confirm: z.literal(true),
});

export const updateMemorySettingsSchema = z.strictObject({
  enabled: z.boolean(),
});
export type UpdateMemorySettingsInput = z.output<
  typeof updateMemorySettingsSchema
>;

export type MemorySourceResponse = {
  conversationId: string | null;
  status: 'active' | 'deleted' | 'unavailable';
};

export type MemoryResponse = {
  id: string;
  category: MemoryCategory;
  valueType: 'single' | 'multi' | 'range';
  value: MemoryValue;
  isPrimary: boolean;
  source: MemorySourceResponse | null;
  createdAt: string;
  updatedAt: string;
};

export type MemorySettingsResponse = {
  enabled: boolean;
  updatedAt: string;
};

export type MemoryListResponse = {
  items: MemoryResponse[];
  settings: MemorySettingsResponse;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export class CreateMemoryDto {
  @ApiProperty({ enum: memoryCategorySchema.options })
  public category!: MemoryCategory;

  @ApiProperty()
  public value!: unknown;

  @ApiPropertyOptional({ default: false })
  public isPrimary = false;
}

export function toMemoryValue(category: MemoryCategory, value: unknown) {
  return parseMemoryValue(category, value);
}
