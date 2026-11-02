import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Roles } from '../../authorization/decorator/roles.decorator.js';
import { RolesGuard } from '../../authorization/guard/roles.guard.js';
import { UserRole } from '../../users/entity/user.entity.js';
import { ChatRecordsService } from '../service/chat-records.service.js';
import {
  AdminChatQueryDto,
  adminChatQuerySchema,
} from '../dto/admin-chat-query.dto.js';
import { PaginationDto, paginationSchema } from '../dto/pagination.dto.js';

@Controller('admin/chat/conversations')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth('bearer')
@ApiTags('管理员聊天记录')
export class AdminChatRecordsController {
  public constructor(private readonly chatRecords: ChatRecordsService) {}

  @Get()
  public list(
    @Query({ schema: adminChatQuerySchema }) query: AdminChatQueryDto,
  ) {
    return this.chatRecords.listForAdmin(query);
  }

  @Get(':id')
  public detail(
    @Param('id', { schema: z.uuid() }) id: string,
    @Query({ schema: paginationSchema }) pagination: PaginationDto,
  ) {
    return this.chatRecords.getForAdmin(id, pagination);
  }
}
