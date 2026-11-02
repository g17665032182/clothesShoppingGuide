import { ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

import { UserRole, UserStatus } from '../entity/user.entity.js';

export const adminUpdateUserSchema = z.strictObject({
  displayName: z.string().min(1).max(100).optional(),
  role: z.enum(UserRole).optional(),
  status: z.enum(UserStatus).optional(),
});

export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;

export class AdminUpdateUserDto {
  @ApiPropertyOptional({
    description: '显示名称',
    example: '系统管理员',
    minLength: 1,
    maxLength: 100,
  })
  public displayName?: string;

  @ApiPropertyOptional({
    description: '用户角色',
    enum: UserRole,
    example: UserRole.USER,
  })
  public role?: UserRole;

  @ApiPropertyOptional({
    description: '用户状态',
    enum: UserStatus,
    example: UserStatus.ACTIVE,
  })
  public status?: UserStatus;
}
