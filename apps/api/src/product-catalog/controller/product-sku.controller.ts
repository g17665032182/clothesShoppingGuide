import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import {
  productSkuQuerySchema,
  type ProductSkuQuery,
} from '../dto/product-sku-query.dto.js';
import { ProductCatalogService } from '../service/product-catalog.service.js';

@Controller('product-catalog/skus')
@ApiBearerAuth('bearer')
@ApiTags('商品目录')
export class ProductSkuController {
  public constructor(
    @Inject(ProductCatalogService)
    private readonly productCatalog: ProductCatalogService,
  ) {}

  @Get()
  public list(
    @Query({ schema: productSkuQuerySchema }) query: ProductSkuQuery,
  ) {
    return this.productCatalog.listSkus(query);
  }
}
