import { tool, type StructuredToolInterface } from '@langchain/core/tools';

import {
  ProductCatalogService,
  productSearchSchema,
} from '../service/product-catalog.service.js';

export function createProductSearchTool(
  catalog: ProductCatalogService,
): StructuredToolInterface {
  return tool(async (input) => JSON.stringify(await catalog.search(input)), {
    name: 'search_local_clothing_products',
    description:
      '按用户明确的服装或鞋类需求搜索本地有效商品。只使用查询返回的商品和匹配信息，不得编造价格、库存或属性。',
    schema: productSearchSchema,
  });
}
