import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { UserRole, UserStatus } from '../user.entity.js';

export class AdminUpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  public displayName?: string;

  @IsOptional()
  @IsEnum(UserRole)
  public role?: UserRole;

  @IsOptional()
  @IsEnum(UserStatus)
  public status?: UserStatus;
}
