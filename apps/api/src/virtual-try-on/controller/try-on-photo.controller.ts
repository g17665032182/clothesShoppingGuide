import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import { TryOnPhotoService } from '../service/try-on-photo.service.js';
import {
  photoSaveSchema,
  TryOnPhotoPageDto,
  type TryOnPhotoDto,
} from '../dto/try-on-photo.dto.js';
import { tryOnUuidParamSchema } from '../dto/try-on-param.dto.js';

@Controller('try-on/photos')
@ApiBearerAuth('bearer')
@ApiTags('AI 试穿照片')
export class TryOnPhotoController {
  public constructor(private readonly photos: TryOnPhotoService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      additionalProperties: false,
      properties: {
        file: { type: 'string', format: 'binary' },
        save: { type: 'boolean', default: false },
      },
    },
  })
  @ApiCreatedResponse({ type: Object })
  public upload(
    @CurrentUser() user: User,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number },
    @Body({ schema: photoSaveSchema }) body: { save: boolean },
  ): Promise<TryOnPhotoDto> {
    return this.photos.upload(user.id, file, body.save);
  }

  @Get()
  @ApiOkResponse({ type: TryOnPhotoPageDto })
  public list(@CurrentUser() user: User) {
    return this.photos.listSaved(user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  public async delete(
    @CurrentUser() user: User,
    @Param({ schema: tryOnUuidParamSchema }) params: { id: string },
  ): Promise<void> {
    await this.photos.deleteSaved(user.id, params.id);
  }
}
