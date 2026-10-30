import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { UserRole, UserStatus } from '../entity/user.entity.js';

export class AdminUpdateUserDto {
  @ApiPropertyOptional({
    description: '显示名称',
    example: '系统管理员',
    minLength: 1,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  public displayName?: string;

  @ApiPropertyOptional({
    description: '用户角色',
    enum: UserRole,
    example: UserRole.USER,
  })
  @IsOptional()
  @IsEnum(UserRole)
  public role?: UserRole;

  @ApiPropertyOptional({
    description: '用户状态',
    enum: UserStatus,
    example: UserStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(UserStatus)
  public status?: UserStatus;
}
