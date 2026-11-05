import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorator/current-user.decorator.js';
import {
  FlushMemoryTasksDto,
  flushMemoryTasksSchema,
  type FlushMemoryTasksInput,
} from '../dto/memory-task.dto.js';
import { UserMemoryTaskService } from '../service/user-memory-task.service.js';

@Controller('memories/tasks')
@ApiBearerAuth('bearer')
@ApiTags('用户 Markdown 记忆')
@ApiUnauthorizedResponse({ description: '请先登录' })
export class UserMemoryTaskController {
  public constructor(private readonly tasks: UserMemoryTaskService) {}

  @Post('flush')
  @HttpCode(204)
  @ApiBody({ type: FlushMemoryTasksDto })
  @ApiNoContentResponse({ description: '待处理记忆任务已提前释放' })
  @ApiBadRequestResponse({ description: '会话 ID 格式错误或包含未知字段' })
  @ApiNotFoundResponse({ description: '会话不存在' })
  public async flush(
    @CurrentUser() user: { id: string },
    @Body({ schema: flushMemoryTasksSchema }) input: FlushMemoryTasksInput,
  ): Promise<void> {
    await this.tasks.flush(user.id, input.conversationId);
  }
}
