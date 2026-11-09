import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorator/current-user.decorator.js';
import type { User } from '../../users/entity/user.entity.js';
import {
  CreateTryOnTaskDto,
  createTryOnTaskSchema,
  TryOnTaskQueryDto,
  tryOnTaskQuerySchema,
  type CreateTryOnTaskInput,
  type TryOnTaskQuery,
} from '../dto/try-on-task.dto.js';
import {
  emptyTryOnActionSchema,
  tryOnUuidParamSchema,
} from '../dto/try-on-param.dto.js';
import { TryOnTaskService } from '../service/try-on-task.service.js';
import { ApiBody } from '@nestjs/swagger';

@Controller('try-on/tasks')
@ApiBearerAuth('bearer')
@ApiTags('AI 试穿任务')
export class TryOnTaskController {
  public constructor(private readonly tasks: TryOnTaskService) {}

  @Post()
  @ApiBody({ type: CreateTryOnTaskDto })
  @ApiAcceptedResponse({ description: '试穿任务已排队' })
  public create(
    @CurrentUser() user: User,
    @Body({ schema: createTryOnTaskSchema }) input: CreateTryOnTaskInput,
  ) {
    return this.tasks.create(user.id, input);
  }

  @Get()
  @ApiOkResponse({ type: TryOnTaskQueryDto })
  public list(
    @CurrentUser() user: User,
    @Query({ schema: tryOnTaskQuerySchema }) query: TryOnTaskQuery,
  ) {
    return this.tasks.list(user.id, query);
  }

  @Get(':id')
  public get(
    @CurrentUser() user: User,
    @Param({ schema: tryOnUuidParamSchema }) params: { id: string },
  ) {
    return this.tasks.get(user.id, params.id);
  }

  @Get(':id/result')
  public result(
    @CurrentUser() user: User,
    @Param({ schema: tryOnUuidParamSchema }) params: { id: string },
  ) {
    return this.tasks.download(user.id, params.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  public async delete(
    @CurrentUser() user: User,
    @Param({ schema: tryOnUuidParamSchema }) params: { id: string },
  ): Promise<void> {
    await this.tasks.delete(user.id, params.id);
  }

  @Post(':id/notification-read')
  @HttpCode(204)
  @ApiNoContentResponse()
  public async markRead(
    @CurrentUser() user: User,
    @Param({ schema: tryOnUuidParamSchema }) params: { id: string },
    @Body({ schema: emptyTryOnActionSchema }) _body: Record<string, never>,
  ): Promise<void> {
    await this.tasks.markRead(user.id, params.id);
  }
}
