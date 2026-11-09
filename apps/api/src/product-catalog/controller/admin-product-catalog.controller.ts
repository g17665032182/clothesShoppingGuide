import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { Roles } from '../../authorization/decorator/roles.decorator.js';
import { RolesGuard } from '../../authorization/guard/roles.guard.js';
import { UserRole } from '../../users/entity/user.entity.js';
import {
  AdminProductIdDto,
  adminProductIdSchema,
} from '../dto/admin-product-id.dto.js';
import {
  AdminProductQueryDto,
  adminProductQuerySchema,
} from '../dto/admin-product-query.dto.js';
import {
  AdminProductDetailDto,
  AdminProductPageDto,
} from '../dto/admin-product-response.dto.js';
import { AdminProductCatalogService } from '../service/admin-product-catalog.service.js';
import {
  AdminProductTryOnUpdateDto,
  adminProductTryOnUpdateSchema,
  type AdminProductTryOnUpdate,
} from '../dto/admin-product-try-on.dto.js';

@Controller('admin/product-catalog/products')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth('bearer')
@ApiTags('管理员商品目录')
export class AdminProductCatalogController {
  public constructor(
    @Inject(AdminProductCatalogService)
    private readonly products: AdminProductCatalogService,
  ) {}

  @Get()
  @ApiOkResponse({ type: AdminProductPageDto })
  @ApiForbiddenResponse({ description: '仅管理员可访问' })
  public list(
    @Query({ schema: adminProductQuerySchema }) query: AdminProductQueryDto,
  ) {
    return this.products.list(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: AdminProductDetailDto })
  @ApiForbiddenResponse({ description: '仅管理员可访问' })
  @ApiNotFoundResponse({ description: '商品不存在' })
  public detail(
    @Param({ schema: adminProductIdSchema }) input: AdminProductIdDto,
  ) {
    return this.products.detail(input.id);
  }

  @Patch(':id/try-on')
  @ApiBody({ type: AdminProductTryOnUpdateDto })
  @ApiOkResponse({ type: AdminProductDetailDto })
  @ApiBadRequestResponse({ description: '商品 ID 或试穿设置输入无效' })
  @ApiUnauthorizedResponse({ description: '未登录或账号不可用' })
  @ApiForbiddenResponse({ description: '仅管理员可修改' })
  @ApiNotFoundResponse({ description: '商品不存在' })
  @ApiConflictResponse({ description: '当前商品不符合试穿开启条件' })
  public updateTryOn(
    @Param({ schema: adminProductIdSchema }) input: AdminProductIdDto,
    @Body({ schema: adminProductTryOnUpdateSchema })
    body: AdminProductTryOnUpdate,
  ) {
    return this.products.updateTryOn(input.id, body);
  }
}
