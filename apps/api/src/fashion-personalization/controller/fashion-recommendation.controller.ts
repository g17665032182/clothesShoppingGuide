import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorator/current-user.decorator.js';
import {
  RecommendationFeedbackDto,
  RecommendationFeedbackResponseDto,
  recommendationFeedbackSchema,
  type RecommendationFeedbackInput,
} from '../dto/recommendation-feedback.dto.js';
import {
  RecommendationProfileClearDto,
  recommendationProfileClearSchema,
  type RecommendationProfileClearInput,
} from '../dto/recommendation-profile-clear.dto.js';
import { RecommendationProfileResponseDto } from '../dto/recommendation-profile.dto.js';
import {
  RecommendationSettingsDto,
  UpdateRecommendationSettingsDto,
  recommendationSettingsSchema,
  type RecommendationSettingsInput,
} from '../dto/recommendation-settings.dto.js';
import { RecommendationFeedbackService } from '../service/recommendation-feedback.service.js';
import { RecommendationProfileService } from '../service/recommendation-profile.service.js';
import { RecommendationSettingsService } from '../service/recommendation-settings.service.js';

@Controller('fashion-recommendation')
@ApiBearerAuth('bearer')
@ApiTags('个性化商品与穿搭推荐')
@ApiUnauthorizedResponse({ description: '请先登录' })
export class FashionRecommendationController {
  public constructor(
    private readonly feedback: RecommendationFeedbackService,
    private readonly profiles: RecommendationProfileService,
    private readonly settings: RecommendationSettingsService,
  ) {}

  @Post('feedback')
  @ApiBody({ type: RecommendationFeedbackDto })
  @ApiCreatedResponse({ type: RecommendationFeedbackResponseDto })
  @ApiBadRequestResponse({ description: '反馈参数或敏感内容不合法' })
  @ApiNotFoundResponse({ description: '推荐目标不存在或不属于当前用户' })
  public submitFeedback(
    @CurrentUser() user: { id: string },
    @Body({ schema: recommendationFeedbackSchema })
    input: RecommendationFeedbackInput,
  ) {
    return this.feedback.submit(user.id, input);
  }

  @Get('profile')
  @ApiOkResponse({ type: RecommendationProfileResponseDto })
  public getProfile(@CurrentUser() user: { id: string }) {
    return this.profiles.get(user.id);
  }

  @Delete('profile')
  @HttpCode(204)
  @ApiBody({ type: RecommendationProfileClearDto })
  @ApiNoContentResponse({ description: '推荐画像和未汇总反馈已清空' })
  @ApiBadRequestResponse({ description: '必须提供 confirm: true' })
  public async clearProfile(
    @CurrentUser() user: { id: string },
    @Body({ schema: recommendationProfileClearSchema })
    _input: RecommendationProfileClearInput,
  ): Promise<void> {
    await this.profiles.clear(user.id);
  }

  @Get('settings')
  @ApiOkResponse({ type: RecommendationSettingsDto })
  public getSettings(@CurrentUser() user: { id: string }) {
    return this.settings.get(user.id);
  }

  @Patch('settings')
  @ApiBody({ type: UpdateRecommendationSettingsDto })
  @ApiOkResponse({ type: RecommendationSettingsDto })
  @ApiBadRequestResponse({ description: '仅接受 enabled 布尔值' })
  public updateSettings(
    @CurrentUser() user: { id: string },
    @Body({ schema: recommendationSettingsSchema })
    input: RecommendationSettingsInput,
  ) {
    return this.settings.update(user.id, input);
  }
}
