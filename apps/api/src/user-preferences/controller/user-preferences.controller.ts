import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorator/current-user.decorator.js';
import {
  createPreferenceSchema,
  CreatePreferenceDto,
  deleteAllPreferenceSchema,
  listPreferenceQuerySchema,
  updatePreferenceSchema,
  type CreatePreferenceInput,
  type ListPreferenceQuery,
  type UpdatePreferenceInput,
} from '../dto/user-preference.dto.js';
import { preferenceIdParamSchema } from '../dto/preference-id.dto.js';
import {
  PreferenceSettingsDto,
  UpdatePreferenceSettingsDto,
  updatePreferenceSettingsSchema,
  type UpdatePreferenceSettingsInput,
} from '../dto/preference-settings.dto.js';
import { UserPreferencesService } from '../service/user-preferences.service.js';
import { UserPreferenceSettingsService } from '../service/user-preference-settings.service.js';

@Controller('preferences')
@ApiBearerAuth('bearer')
@ApiTags('用户偏好')
@ApiUnauthorizedResponse({ description: '需要登录' })
export class UserPreferencesController {
  public constructor(
    @Inject(UserPreferencesService)
    private readonly preferences: UserPreferencesService,
    @Inject(UserPreferenceSettingsService)
    private readonly settings: UserPreferenceSettingsService,
  ) {}

  @Get('settings')
  @ApiOkResponse({ type: PreferenceSettingsDto })
  public getSettings(@CurrentUser() user: { id: string }) {
    return this.settings.getSettings(user.id);
  }

  @Patch('settings')
  @ApiBody({ type: UpdatePreferenceSettingsDto })
  @ApiOkResponse({ type: PreferenceSettingsDto })
  @ApiBadRequestResponse({ description: '仅接受 enabled 布尔值' })
  public updateSettings(
    @CurrentUser() user: { id: string },
    @Body({ schema: updatePreferenceSettingsSchema })
    input: UpdatePreferenceSettingsInput,
  ) {
    return this.settings.updateSettings(user.id, input);
  }

  @Get()
  @ApiOkResponse({ description: '当前用户的偏好分页列表及独立偏好设置' })
  public list(
    @CurrentUser() user: { id: string },
    @Query({ schema: listPreferenceQuerySchema }) query: ListPreferenceQuery,
  ) {
    return this.preferences.list(user.id, query);
  }

  @Post()
  @ApiBody({ type: CreatePreferenceDto })
  @ApiCreatedResponse({ description: '创建或复用后的偏好，不包含内部字段' })
  @ApiBadRequestResponse({ description: '偏好值不合法或包含敏感信息' })
  public create(
    @CurrentUser() user: { id: string },
    @Body({ schema: createPreferenceSchema }) input: CreatePreferenceInput,
  ) {
    return this.preferences.create(user.id, input);
  }

  @Patch(':id')
  @ApiOkResponse({ description: '更新后的偏好' })
  @ApiBadRequestResponse({ description: '请求无变更、值非法或同类偏好重复' })
  @ApiNotFoundResponse({ description: '偏好不存在或不属于当前用户' })
  public update(
    @CurrentUser() user: { id: string },
    @Param('id', { schema: preferenceIdParamSchema }) id: string,
    @Body({ schema: updatePreferenceSchema }) input: UpdatePreferenceInput,
  ) {
    return this.preferences.update(user.id, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse({ description: '偏好已逻辑删除' })
  @ApiNotFoundResponse({ description: '偏好不存在或不属于当前用户' })
  public async delete(
    @CurrentUser() user: { id: string },
    @Param('id', { schema: preferenceIdParamSchema }) id: string,
  ): Promise<void> {
    await this.preferences.delete(user.id, id);
  }

  @Delete()
  @ApiBody({
    schema: {
      type: 'object',
      properties: { confirm: { type: 'boolean', enum: [true] } },
      required: ['confirm'],
      additionalProperties: false,
    },
  })
  @ApiOkResponse({ description: '本次逻辑删除的偏好数量' })
  @ApiBadRequestResponse({ description: '需要 confirm: true' })
  public deleteAll(
    @CurrentUser() user: { id: string },
    @Body({ schema: deleteAllPreferenceSchema })
    _confirmation: { confirm: true },
  ) {
    return this.preferences.deleteAll(user.id);
  }
}
