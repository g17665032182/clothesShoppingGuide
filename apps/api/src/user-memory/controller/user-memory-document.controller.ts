import { Body, Controller, Delete, Get, HttpCode, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../../auth/decorator/current-user.decorator.js';
import {
  updateMemoryDocumentSchema,
  UpdateUserMemoryDocumentDto,
  UserMemoryDocumentDto,
  type UpdateMemoryDocumentInput,
} from '../dto/user-memory-document.dto.js';
import { UserMemoryDocumentService } from '../service/user-memory-document.service.js';

@Controller('memories/document')
@ApiBearerAuth('bearer')
@ApiTags('用户 Markdown 记忆')
@ApiUnauthorizedResponse({ description: '请先登录' })
export class UserMemoryDocumentController {
  public constructor(private readonly documents: UserMemoryDocumentService) {}

  @Get()
  @ApiOkResponse({ type: UserMemoryDocumentDto })
  @ApiServiceUnavailableResponse({ description: '记忆文档存储暂不可用' })
  public get(@CurrentUser() user: { id: string }) {
    return this.documents.get(user.id);
  }

  @Put()
  @ApiBody({ type: UpdateUserMemoryDocumentDto })
  @ApiOkResponse({ type: UserMemoryDocumentDto })
  @ApiBadRequestResponse({ description: '文档内容或请求格式不合法' })
  @ApiConflictResponse({ description: '文档版本冲突' })
  @ApiServiceUnavailableResponse({ description: '记忆文档存储暂不可用' })
  public update(
    @CurrentUser() user: { id: string },
    @Body({ schema: updateMemoryDocumentSchema })
    input: UpdateMemoryDocumentInput,
  ) {
    return this.documents.update(user.id, input);
  }

  @Delete()
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Markdown 记忆文档已清空' })
  public async clear(@CurrentUser() user: { id: string }): Promise<void> {
    await this.documents.clear(user.id);
  }
}
