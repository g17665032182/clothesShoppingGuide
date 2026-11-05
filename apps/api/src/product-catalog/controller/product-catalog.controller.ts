import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import {
  productSearchQuerySchema,
  ProductCatalogService,
} from '../service/product-catalog.service.js';

export const nextPageSchema = z.strictObject({
  query: productSearchQuerySchema,
  cursor: z.string().min(1).max(4096),
});

type NextPageInput = z.output<typeof nextPageSchema>;

@Controller('product-catalog')
@ApiBearerAuth('bearer')
@ApiTags('商品目录')
export class ProductCatalogController {
  public constructor(private readonly productCatalog: ProductCatalogService) {}

  @Post('next-page')
  public nextPage(@Body({ schema: nextPageSchema }) input: NextPageInput) {
    return this.productCatalog.getNextPage(input.query, input.cursor);
  }
}
