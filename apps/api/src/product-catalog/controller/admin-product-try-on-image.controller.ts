import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { Roles } from '../../authorization/decorator/roles.decorator.js';
import { RolesGuard } from '../../authorization/guard/roles.guard.js';
import { UserRole } from '../../users/entity/user.entity.js';
import {
  adminProductIdSchema,
  type AdminProductIdDto,
} from '../dto/admin-product-id.dto.js';
import { adminProductTryOnImageBodySchema } from '../dto/admin-product-try-on-image.dto.js';
import { AdminProductDetailDto } from '../dto/admin-product-response.dto.js';
import { ProductTryOnImageService } from '../service/product-try-on-image.service.js';
import { AdminProductCatalogService } from '../service/admin-product-catalog.service.js';
import { PRODUCT_TRY_ON_MAX_BYTES } from '../service/product-try-on-image-processing.service.js';
import { ProductTryOnImageSizeFilter } from '../filter/product-try-on-image-size.filter.js';

@Controller('admin/product-catalog/products')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth('bearer')
@ApiTags('管理员商品目录')
@ApiUnauthorizedResponse({ description: '未登录或账号不可用' })
@ApiForbiddenResponse({ description: '仅管理员可访问' })
@ApiNotFoundResponse({ description: '商品或试穿图片不存在' })
@ApiBadRequestResponse({ description: '商品 ID、文件内容或大小无效' })
@ApiServiceUnavailableResponse({ description: '私有图片存储暂不可用' })
export class AdminProductTryOnImageController {
  public constructor(
    @Inject(ProductTryOnImageService)
    private readonly images: ProductTryOnImageService,
    @Inject(AdminProductCatalogService)
    private readonly products: AdminProductCatalogService,
  ) {}

  @Post(':id/try-on-image')
  @UseFilters(ProductTryOnImageSizeFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: PRODUCT_TRY_ON_MAX_BYTES, files: 1, fields: 0 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      additionalProperties: false,
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ type: AdminProductDetailDto })
  @ApiConflictResponse({ description: '商品已上传试穿图，不允许覆盖' })
  public async upload(
    @Param({ schema: adminProductIdSchema }) params: AdminProductIdDto,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Body({ schema: adminProductTryOnImageBodySchema })
    _body: Record<string, never>,
  ): Promise<AdminProductDetailDto> {
    if (!file) throw new BadRequestException('请选择商品试穿图片');
    await this.images.upload(params.id, file);
    return this.products.detail(params.id);
  }

  @Get(':id/try-on-image')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiProduces('image/webp')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  public async preview(
    @Param({ schema: adminProductIdSchema }) params: AdminProductIdDto,
  ): Promise<StreamableFile> {
    return new StreamableFile(await this.images.preview(params.id), {
      type: 'image/webp',
    });
  }
}
