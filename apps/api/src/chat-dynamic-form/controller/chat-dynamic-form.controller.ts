import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorator/current-user.decorator.js';
import type { User } from '../../users/entity/user.entity.js';
import {
  dynamicFormRouteParamsSchema,
  dynamicFormCancelSchema,
  dynamicFormSubmitSchema,
  type DynamicFormRouteParams,
  type DynamicFormCancelInput,
  type DynamicFormSubmitInput,
} from '../dto/chat-dynamic-form.schema.js';
import { DynamicFormResponseDto } from '../dto/chat-dynamic-form-response.js';
import { ChatDynamicFormService } from '../service/chat-dynamic-form.service.js';

@Controller('chat/conversations/:conversationId/dynamic-forms')
@ApiBearerAuth('bearer')
@ApiTags('聊天动态表单')
@ApiUnauthorizedResponse({ description: '未登录或账号禁用' })
@ApiBadRequestResponse({ description: '请求结构或字段不合法' })
@ApiConflictResponse({ description: '表单状态、版本或业务资源发生冲突' })
export class ChatDynamicFormController {
  public constructor(private readonly forms: ChatDynamicFormService) {}

  @Get(':formId')
  @ApiOkResponse({ type: DynamicFormResponseDto })
  public get(
    @CurrentUser() user: User,
    @Param({ schema: dynamicFormRouteParamsSchema })
    params: DynamicFormRouteParams,
  ) {
    return this.forms.get(user.id, params.conversationId, params.formId);
  }

  @Post(':formId/submit')
  @HttpCode(200)
  @ApiOkResponse({ type: DynamicFormResponseDto })
  public submit(
    @CurrentUser() user: User,
    @Param({ schema: dynamicFormRouteParamsSchema })
    params: DynamicFormRouteParams,
    @Body({ schema: dynamicFormSubmitSchema }) input: DynamicFormSubmitInput,
  ) {
    return this.forms.submit(
      user.id,
      params.conversationId,
      params.formId,
      input,
    );
  }

  @Post(':formId/cancel')
  @HttpCode(200)
  @ApiOkResponse({ type: DynamicFormResponseDto })
  public cancel(
    @CurrentUser() user: User,
    @Param({ schema: dynamicFormRouteParamsSchema })
    params: DynamicFormRouteParams,
    @Body({ schema: dynamicFormCancelSchema }) input: DynamicFormCancelInput,
  ) {
    return this.forms.cancel(
      user.id,
      params.conversationId,
      params.formId,
      input,
    );
  }
}
