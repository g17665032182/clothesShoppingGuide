import { ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

import { PaginationDto } from './pagination.dto.js';

export class AdminChatQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: '按用户 ID 筛选',
    format: 'uuid',
    example: '9c2c6f3b-4d12-4a9e-8c0a-8d6d0a8b8c1e',
  })
  public userId?: string;
}

export const adminChatQuerySchema = z
  .strictObject({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    userId: z.uuid().optional(),
  })
  .transform(({ page, pageSize, userId }) =>
    Object.assign(new AdminChatQueryDto(), {
      page,
      pageSize,
      ...(userId === undefined ? {} : { userId }),
    }),
  );
