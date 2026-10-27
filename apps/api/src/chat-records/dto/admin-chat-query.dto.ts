import { IsOptional, IsUUID } from 'class-validator';

import { PaginationDto } from './pagination.dto.js';

export class AdminChatQueryDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  public userId?: string;
}
