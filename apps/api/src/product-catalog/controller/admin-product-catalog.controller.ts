import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
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
}
