import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { Roles } from '../authorization/decorator/roles.decorator.js';
import { RolesGuard } from '../authorization/guard/roles.guard.js';
import { UserRole } from '../users/user.entity.js';
import { ChatRecordsService } from './chat-records.service.js';
import { AdminChatQueryDto } from './dto/admin-chat-query.dto.js';
import { PaginationDto } from './dto/pagination.dto.js';

@Controller('admin/chat/conversations')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth('bearer')
@ApiTags('管理员聊天记录')
export class AdminChatRecordsController {
  public constructor(private readonly chatRecords: ChatRecordsService) {}

  @Get()
  public list(@Query() query: AdminChatQueryDto) {
    return this.chatRecords.listForAdmin(query);
  }

  @Get(':id')
  public detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.chatRecords.getForAdmin(id, pagination);
  }
}
