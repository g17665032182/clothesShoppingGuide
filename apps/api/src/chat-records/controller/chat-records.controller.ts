import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser } from '../../auth/decorator/current-user.decorator.js';
import type { User } from '../../users/entity/user.entity.js';
import { ChatRecordsService } from '../service/chat-records.service.js';
import { PaginationDto, paginationSchema } from '../dto/pagination.dto.js';
import {
  ChatConversationDetailResponseDto,
  ChatReasoningActivityResponseDto,
  ChatToolActivityResponseDto,
} from '../dto/chat-history-response.dto.js';

@Controller('chat/conversations')
@ApiBearerAuth('bearer')
@ApiTags('聊天记录')
@ApiExtraModels(ChatToolActivityResponseDto, ChatReasoningActivityResponseDto)
export class ChatRecordsController {
  public constructor(private readonly chatRecords: ChatRecordsService) {}

  @Get()
  public list(
    @CurrentUser() user: User,
    @Query({ schema: paginationSchema }) pagination: PaginationDto,
  ) {
    return this.chatRecords.listForUser(user.id, pagination);
  }

  @Get(':id')
  @ApiOkResponse({ type: ChatConversationDetailResponseDto })
  @ApiNotFoundResponse({ description: '会话不存在或不属于当前用户' })
  public detail(
    @CurrentUser() user: User,
    @Param('id', { schema: z.uuid() }) id: string,
    @Query({ schema: paginationSchema }) pagination: PaginationDto,
  ) {
    return this.chatRecords.getForUser(user.id, id, pagination);
  }

  @Delete(':id')
  @HttpCode(204)
  public async delete(
    @CurrentUser() user: User,
    @Param('id', { schema: z.uuid() }) id: string,
  ): Promise<void> {
    await this.chatRecords.deleteForUser(user.id, id);
  }
}
