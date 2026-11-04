import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorator/current-user.decorator.js';
import {
  MemorySettingsDto,
  UpdateMemorySettingsDto,
  updateMemorySettingsSchema,
  type UpdateMemorySettingsInput,
} from '../dto/memory-settings.dto.js';
import { UserMemorySettingsService } from '../service/user-memory-settings.service.js';

@Controller('memories/settings')
@ApiBearerAuth('bearer')
@ApiTags('用户 Markdown 记忆')
@ApiUnauthorizedResponse({ description: '请先登录' })
export class UserMemorySettingsController {
  public constructor(private readonly settings: UserMemorySettingsService) {}

  @Get()
  @ApiOkResponse({ type: MemorySettingsDto })
  public get(@CurrentUser() user: { id: string }) {
    return this.settings.get(user.id);
  }

  @Patch()
  @ApiBody({ type: UpdateMemorySettingsDto })
  @ApiOkResponse({ type: MemorySettingsDto })
  @ApiBadRequestResponse({ description: '开关必须为布尔值，且不接受未知字段' })
  public update(
    @CurrentUser() user: { id: string },
    @Body({ schema: updateMemorySettingsSchema })
    input: UpdateMemorySettingsInput,
  ) {
    return this.settings.update(user.id, input);
  }
}
