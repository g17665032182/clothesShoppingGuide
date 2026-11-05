import { tool, type StructuredToolInterface } from '@langchain/core/tools';

import {
  ProductCatalogService,
  productSearchToolSchema,
} from '../service/product-catalog.service.js';

export function createProductSearchTool(
  catalog: ProductCatalogService,
): StructuredToolInterface {
  let hasSearchedThisTurn = false;
  return tool(
    async (input) => {
      if (hasSearchedThisTurn) {
        return JSON.stringify({
          items: [],
          nextCursor: null,
          noResultReason: null,
        });
      }
      hasSearchedThisTurn = true;
      return JSON.stringify(await catalog.search({ ...input, limit: 3 }));
    },
    {
      name: 'search_local_clothing_products',
      description:
        '按用户明确的服装或鞋类需求搜索本地有效商品。只使用查询返回的商品和匹配信息，不得编造价格、库存或属性。',
      schema: productSearchToolSchema,
    },
  );
}
