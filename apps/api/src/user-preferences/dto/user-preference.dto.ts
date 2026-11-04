import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { BadRequestException } from '@nestjs/common';

import {
  preferenceCategorySchema,
  preferenceValueByCategorySchema,
  parsePreferenceValue,
  type PreferenceCategory,
  type PreferenceValue,
} from '../context/preference-value.schema.js';
import type { PreferenceSettingsResponse } from './preference-settings.dto.js';

export class ListPreferenceQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  public page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  public pageSize = 20;

  @ApiPropertyOptional({ enum: preferenceCategorySchema.options })
  public category?: PreferenceCategory;
}

export const listPreferenceQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  category: preferenceCategorySchema.optional(),
});
export type ListPreferenceQuery = z.output<typeof listPreferenceQuerySchema>;
export type ListPreferenceQueryInput = z.input<
  typeof listPreferenceQuerySchema
>;

const createPreferenceVariant = (category: PreferenceCategory) => {
  const valueSchema = preferenceValueByCategorySchema.options.find(
    (option) => option.shape.category.value === category,
  )!.shape.value;
  return z.strictObject({
    category: z.literal(category),
    value: valueSchema,
    isPrimary: z.boolean().default(false),
  });
};

export const createPreferenceSchema = z.discriminatedUnion('category', [
  createPreferenceVariant('size'),
  createPreferenceVariant('shoe_size'),
  createPreferenceVariant('fit'),
  createPreferenceVariant('style'),
  createPreferenceVariant('color'),
  createPreferenceVariant('occasion'),
  createPreferenceVariant('budget'),
  createPreferenceVariant('avoidance'),
  createPreferenceVariant('purchase_preference'),
]);

export type CreatePreferenceInput = z.output<typeof createPreferenceSchema>;
export type CreatePreferenceRequest = z.input<typeof createPreferenceSchema>;

export const updatePreferenceSchema = z
  .strictObject({
    category: preferenceCategorySchema.optional(),
    value: z.unknown().optional(),
    isPrimary: z.boolean().optional(),
  })
  .refine(
    ({ category, value, isPrimary }) =>
      category !== undefined || value !== undefined || isPrimary !== undefined,
    '至少提供一个可更新字段',
  );
export type UpdatePreferenceInput = z.output<typeof updatePreferenceSchema>;

export const deleteAllPreferenceSchema = z.strictObject({
  confirm: z.literal(true),
});

export type PreferenceSourceResponse = {
  conversationId: string | null;
  status: 'active' | 'deleted' | 'unavailable';
};

export type PreferenceResponse = {
  id: string;
  category: PreferenceCategory;
  valueType: 'single' | 'multi' | 'range';
  value: PreferenceValue;
  isPrimary: boolean;
  source: PreferenceSourceResponse | null;
  createdAt: string;
  updatedAt: string;
};

export type PreferenceListResponse = {
  items: PreferenceResponse[];
  settings: PreferenceSettingsResponse;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export class CreatePreferenceDto {
  @ApiProperty({ enum: preferenceCategorySchema.options })
  public category!: PreferenceCategory;

  @ApiProperty({
    description:
      '按类别填写的偏好值。文本字段支持预设代码及自定义短文本（1–32 字符）；风格/场景最多 5 项、购买偏好 6 项、颜色/避开内容 8 项。鞋码 20–60；预算为非负整数。',
  })
  public value!: unknown;

  @ApiPropertyOptional({ default: false })
  public isPrimary = false;
}

export function toPreferenceValue(
  category: PreferenceCategory,
  value: unknown,
) {
  try {
    return parsePreferenceValue(category, value);
  } catch (error) {
    // 局部更新需要读取原类别后再校验，校验失败仍使用与创建一致的 400 语义。
    if (error instanceof z.ZodError) {
      throw new BadRequestException(
        '偏好值不符合要求，请检查数量、长度和数值范围',
      );
    }
    throw error;
  }
}
