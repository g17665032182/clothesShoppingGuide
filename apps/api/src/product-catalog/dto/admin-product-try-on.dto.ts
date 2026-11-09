import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const adminProductTryOnUpdateSchema = z.strictObject({
  tryOnEnabled: z.boolean(),
});

export type AdminProductTryOnUpdate = z.infer<
  typeof adminProductTryOnUpdateSchema
>;

/** Swagger 仅提供接口文档，实际校验由严格 Zod schema 执行。 */
export class AdminProductTryOnUpdateDto {
  @ApiProperty({ type: Boolean, description: '是否允许该商品试穿' })
  public tryOnEnabled!: boolean;
}
