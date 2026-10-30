import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorator/current-user.decorator.js';
import type { User } from '../../users/entity/user.entity.js';
import { ChatRecordsService } from '../service/chat-records.service.js';
import { PaginationDto } from '../dto/pagination.dto.js';

@Controller('chat/conversations')
@ApiBearerAuth('bearer')
@ApiTags('聊天记录')
export class ChatRecordsController {
  public constructor(private readonly chatRecords: ChatRecordsService) {}

  @Get()
  public list(@CurrentUser() user: User, @Query() pagination: PaginationDto) {
    return this.chatRecords.listForUser(user.id, pagination);
  }

  @Get(':id')
  public detail(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.chatRecords.getForUser(user.id, id, pagination);
  }

  @Delete(':id')
  @HttpCode(204)
  public async delete(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.chatRecords.deleteForUser(user.id, id);
  }
}
