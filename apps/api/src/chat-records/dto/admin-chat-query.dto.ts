import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { PaginationDto } from './pagination.dto.js';

export class AdminChatQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: '按用户 ID 筛选',
    format: 'uuid',
    example: '9c2c6f3b-4d12-4a9e-8c0a-8d6d0a8b8c1e',
  })
  @IsOptional()
  @IsUUID()
  public userId?: string;
}
