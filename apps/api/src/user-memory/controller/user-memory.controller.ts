import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorator/current-user.decorator.js';
import type { User } from '../../users/entity/user.entity.js';
import {
  createMemorySchema,
  deleteAllMemorySchema,
  listMemoryQuerySchema,
  updateMemorySchema,
  updateMemorySettingsSchema,
  type CreateMemoryInput,
  type ListMemoryQueryDto,
  type UpdateMemoryInput,
  type UpdateMemorySettingsInput,
} from '../dto/user-memory.dto.js';
import { memoryIdParamSchema } from '../dto/memory-id.dto.js';
import { UserMemoryService } from '../service/user-memory.service.js';

@Controller('memories')
@ApiBearerAuth('bearer')
@ApiTags('用户长期记忆')
export class UserMemoryController {
  public constructor(private readonly userMemory: UserMemoryService) {}

  @Get()
  @ApiOkResponse({ description: '当前用户的长期记忆分页列表和设置' })
  public list(
    @CurrentUser() user: User,
    @Query({ schema: listMemoryQuerySchema }) query: ListMemoryQueryDto,
  ) {
    return this.userMemory.list(user.id, query);
  }

  @Post()
  @ApiBody({
    schema: {
      oneOf: [
        { $ref: '#/components/schemas/CreateMemoryDto' },
        { type: 'object' },
      ],
    },
  })
  @ApiCreatedResponse({ description: '创建或复用后的记忆' })
  public create(
    @CurrentUser() user: User,
    @Body({ schema: createMemorySchema }) input: CreateMemoryInput,
  ) {
    return this.userMemory.create(user.id, input);
  }

  @Patch('settings')
  @ApiOkResponse({ description: '记忆设置' })
  public updateSettings(
    @CurrentUser() user: User,
    @Body({ schema: updateMemorySettingsSchema })
    input: UpdateMemorySettingsInput,
  ) {
    return this.userMemory.updateSettings(user.id, input);
  }

  @Patch(':id')
  @ApiOkResponse({ description: '更新后的记忆' })
  public update(
    @CurrentUser() user: User,
    @Param('id', { schema: memoryIdParamSchema }) id: string,
    @Body({ schema: updateMemorySchema }) input: UpdateMemoryInput,
  ) {
    return this.userMemory.update(user.id, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse({ description: '记忆已删除' })
  public async delete(
    @CurrentUser() user: User,
    @Param('id', { schema: memoryIdParamSchema }) id: string,
  ): Promise<void> {
    await this.userMemory.delete(user.id, id);
  }

  @Delete()
  @ApiOkResponse({ description: '删除数量' })
  public deleteAll(
    @CurrentUser() user: User,
    @Body({ schema: deleteAllMemorySchema }) _confirmation: { confirm: true },
  ) {
    return this.userMemory.deleteAll(user.id);
  }
}
