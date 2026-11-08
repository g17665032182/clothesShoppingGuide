import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Res,
  HttpCode,
  Inject,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { ServerResponse } from 'node:http';
import { CurrentUser } from '../../auth/decorator/current-user.decorator.js';
import type { User } from '../../users/entity/user.entity.js';
import {
  purchaseConversationParamsSchema,
  purchaseDraftParamsSchema,
  purchaseEmptyQuerySchema,
  startPurchaseSchema,
  patchPurchaseSchema,
  purchaseVersionSchema,
  type StartPurchaseInput,
  type PatchPurchaseInput,
  type PurchaseVersionInput,
} from '../dto/chat-purchase.schema.js';
import { PurchaseDraftService } from '../service/purchase-draft.service.js';
import { PurchaseConfirmationService } from '../service/purchase-confirmation.service.js';
import {
  PatchPurchaseDto,
  PurchaseVersionDto,
  PurchaseDraftDto,
  PurchaseStateDto,
} from '../dto/chat-purchase-swagger.dto.js';

@Controller('chat/conversations/:conversationId/purchase-draft')
@ApiBearerAuth('bearer')
@ApiTags('聊天购买')
@ApiBadRequestResponse({ description: '请求字段、版本或路径不合法' })
@ApiUnauthorizedResponse({ description: '未登录或账号禁用' })
@ApiNotFoundResponse({ description: '会话或草稿不存在或不属于本人' })
@ApiConflictResponse({
  description: '版本、报价、库存或草稿状态冲突，需重新读取',
})
export class ChatPurchaseController {
  public constructor(
    @Inject(PurchaseDraftService) private readonly drafts: PurchaseDraftService,
    @Inject(PurchaseConfirmationService)
    private readonly confirmation: PurchaseConfirmationService,
  ) {}

  @Get()
  @ApiOkResponse({
    type: PurchaseStateDto,
    description: '当前或最近草稿及本人订单，没有草稿时均为 null',
  })
  public read(
    @CurrentUser() user: User,
    @Param({ schema: purchaseConversationParamsSchema })
    params: { conversationId: string },
    @Query({ schema: purchaseEmptyQuerySchema }) _query: Record<string, never>,
  ) {
    return this.drafts.read(user.id, params.conversationId);
  }
  @Post('start')
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: 'object',
      required: ['productExternalId', 'expectedVersion'],
      additionalProperties: false,
      properties: {
        productExternalId: { type: 'string', minLength: 1, maxLength: 160 },
        expectedVersion: { type: 'integer', minimum: 1, nullable: true },
      },
    },
  })
  @ApiOkResponse({
    type: PurchaseStateDto,
    description: '发起、替换或恢复本人购买草稿',
  })
  public start(
    @CurrentUser() user: User,
    @Param({ schema: purchaseConversationParamsSchema })
    params: { conversationId: string },
    @Query({ schema: purchaseEmptyQuerySchema }) _query: Record<string, never>,
    @Body({ schema: startPurchaseSchema }) input: StartPurchaseInput,
  ) {
    return this.drafts.start(user.id, params.conversationId, input);
  }
  @Patch(':draftId')
  @ApiBody({ type: PatchPurchaseDto })
  @ApiOkResponse({
    type: PurchaseDraftDto,
    description: '修改后的草稿安全投影',
  })
  public patch(
    @CurrentUser() user: User,
    @Param({ schema: purchaseDraftParamsSchema })
    params: { conversationId: string; draftId: string },
    @Query({ schema: purchaseEmptyQuerySchema }) _query: Record<string, never>,
    @Body({ schema: patchPurchaseSchema }) input: PatchPurchaseInput,
  ) {
    return this.drafts.patch(
      user.id,
      params.conversationId,
      params.draftId,
      input,
    );
  }
  @Post(':draftId/discard')
  @HttpCode(200)
  @ApiBody({ type: PurchaseVersionDto })
  @ApiOkResponse({
    type: PurchaseDraftDto,
    description: '已终止的草稿投影，不影响正式订单',
  })
  public discard(
    @CurrentUser() user: User,
    @Param({ schema: purchaseDraftParamsSchema })
    params: { conversationId: string; draftId: string },
    @Query({ schema: purchaseEmptyQuerySchema }) _query: Record<string, never>,
    @Body({ schema: purchaseVersionSchema }) input: PurchaseVersionInput,
  ) {
    return this.drafts.discard(
      user.id,
      params.conversationId,
      params.draftId,
      input.expectedVersion,
    );
  }
  @Post(':draftId/confirm')
  @ApiBody({ type: PurchaseVersionDto })
  @ApiCreatedResponse({
    type: PurchaseStateDto,
    description: '首次确认创建待支付订单',
  })
  @ApiOkResponse({
    type: PurchaseStateDto,
    description: '成功版本幂等恢复原订单',
  })
  public async confirm(
    @CurrentUser() user: User,
    @Param({ schema: purchaseDraftParamsSchema })
    params: { conversationId: string; draftId: string },
    @Query({ schema: purchaseEmptyQuerySchema }) _query: Record<string, never>,
    @Body({ schema: purchaseVersionSchema }) input: PurchaseVersionInput,
    @Res({ passthrough: true }) response: ServerResponse,
  ) {
    const { created, ...result } = await this.confirmation.confirm(
      user.id,
      params.conversationId,
      params.draftId,
      input.expectedVersion,
    );
    response.statusCode = created ? 201 : 200;
    return result;
  }
}
