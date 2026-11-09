import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  StreamableFile,
} from '@nestjs/common';
import { ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Public } from '../../auth/decorator/public.decorator.js';
import { LocalTryOnObjectStoreService } from '../service/local-try-on-object-store.service.js';

const localAssetParamSchema = z.strictObject({
  token: z
    .string()
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u),
});

@Controller('try-on/local-assets')
@ApiTags('AI 试穿本地开发资源')
export class TryOnLocalAssetController {
  public constructor(private readonly store: LocalTryOnObjectStoreService) {}

  @Public()
  @Get(':token')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  public async download(
    @Param({ schema: localAssetParamSchema }) params: { token: string },
  ): Promise<StreamableFile> {
    try {
      const result = await this.store.getSignedObject(params.token);
      return new StreamableFile(result.body, {
        type: result.mimeType,
        disposition: 'inline',
      });
    } catch {
      throw new NotFoundException('试穿结果不存在或下载地址已失效');
    }
  }
}
