import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser } from '../../auth/decorator/current-user.decorator.js';
import { Roles } from '../../authorization/decorator/roles.decorator.js';
import { RolesGuard } from '../../authorization/guard/roles.guard.js';
import { UserRole } from '../../users/entity/user.entity.js';
import { ReturnRefundEvidenceService } from '../service/return-refund-evidence.service.js';

const evidenceParamSchema = z.strictObject({
  id: z.uuid(),
  evidenceId: z.uuid(),
});
type EvidenceParams = z.output<typeof evidenceParamSchema>;

const MAX_MULTIPART_BYTES = 50 * 1024 * 1024;

@Controller()
@ApiBearerAuth('bearer')
@ApiTags('退货退款凭证')
export class ReturnRefundEvidenceController {
  public constructor(private readonly evidence: ReturnRefundEvidenceService) {}

  @Post('return-refund-applications/:id/evidence')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_MULTIPART_BYTES },
    }),
  )
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      additionalProperties: false,
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiCreatedResponse({ type: Object })
  @ApiNotFoundResponse({ description: '售后申请不存在' })
  public upload(
    @CurrentUser() user: { id: string },
    @Param({ schema: z.strictObject({ id: z.uuid() }) }) params: { id: string },
    @UploadedFile()
    file: { buffer: Buffer; mimetype: string; size: number } | undefined,
  ) {
    return this.evidence.uploadForUser(user.id, params.id, file ?? {});
  }

  @Get('return-refund-applications/:id/evidence/:evidenceId')
  @ApiProduces('image/jpeg', 'image/png', 'image/webp', 'video/mp4')
  @ApiOkResponse({ description: '私有凭证内容' })
  @ApiNotFoundResponse({ description: '凭证不存在或不属于当前用户' })
  public async downloadForUser(
    @CurrentUser() user: { id: string },
    @Param({ schema: evidenceParamSchema }) params: EvidenceParams,
  ): Promise<StreamableFile> {
    const download = await this.evidence.downloadForUser(
      user.id,
      params.id,
      params.evidenceId,
    );
    return this.toStream(download);
  }

  @Delete('return-refund-applications/:id/evidence/:evidenceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: '凭证已删除' })
  @ApiNotFoundResponse({ description: '凭证不存在或不属于当前用户' })
  public async deleteForUser(
    @CurrentUser() user: { id: string },
    @Param({ schema: evidenceParamSchema }) params: EvidenceParams,
  ): Promise<void> {
    await this.evidence.deleteForUser(user.id, params.id, params.evidenceId);
  }

  @Get('admin/return-refund-applications/:id/evidence/:evidenceId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiProduces('image/jpeg', 'image/png', 'image/webp', 'video/mp4')
  @ApiOkResponse({ description: '管理员审核用的私有凭证内容' })
  @ApiNotFoundResponse({ description: '凭证不存在' })
  public async downloadForAdmin(
    @Param({ schema: evidenceParamSchema }) params: EvidenceParams,
  ): Promise<StreamableFile> {
    const download = await this.evidence.downloadForAdmin(
      params.id,
      params.evidenceId,
    );
    return this.toStream(download);
  }

  private toStream(download: {
    body: Buffer;
    mediaType: string;
    fileName: string;
  }): StreamableFile {
    return new StreamableFile(download.body, {
      type: download.mediaType,
      disposition: `attachment; filename="${download.fileName}"`,
      length: download.body.byteLength,
    });
  }
}
