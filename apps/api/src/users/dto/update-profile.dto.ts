import { ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const updateProfileSchema = z.strictObject({
  displayName: z.string().min(1).max(100).optional(),
  password: z.string().min(8).max(128).optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: '新的显示名称',
    example: '春日衣橱',
    minLength: 1,
    maxLength: 100,
  })
  public displayName?: string;

  @ApiPropertyOptional({
    description: '新密码',
    example: 'NewPassword123!',
    format: 'password',
    minLength: 8,
    maxLength: 128,
  })
  public password?: string;
}
