import { tool } from '@langchain/core/tools';

import {
  productSkuLookupResultSchema,
  productSkuLookupSchema,
  type ProductSkuLookupInput,
  type ProductSkuReaderService,
} from '../../product-catalog/index.js';

export function createChatProductSkusTool(
  reader: Pick<ProductSkuReaderService, 'listForChat'>,
  onRequested: () => void,
) {
  return tool(
    async (input: ProductSkuLookupInput) => {
      // 参数通过校验即标记整轮来源，空结果和失败也不能绕过记忆隔离。
      onRequested();
      try {
        const result = await reader.listForChat(input);
        // 在工具边界再次投影，避免未来领域结果扩展时透出内部标识或库存数量。
        const projection = result.ok
          ? {
              ok: result.ok,
              productExternalId: result.productExternalId,
              items: result.items.map((item) => ({
                color: item.color,
                size: item.size,
                unitPrice: item.unitPrice,
                currency: item.currency,
                inStock: item.inStock,
              })),
              page: result.page,
              pageSize: result.pageSize,
              total: result.total,
              hasNext: result.hasNext,
            }
          : { ok: result.ok, code: result.code };
        const parsed = productSkuLookupResultSchema.safeParse(projection);
        return JSON.stringify(
          parsed.success ? parsed.data : { ok: false, code: 'unavailable' },
        );
      } catch {
        return JSON.stringify({ ok: false, code: 'unavailable' });
      }
    },
    {
      name: 'get_product_skus',
      description:
        '查询已知本地服装商品的在售颜色、尺码、单价和是否有库存。productExternalId 可来自商品查询结果、用户明确提供的外部标识或可唯一确定的可信引用；不能凭空猜测。可按 color 或 size 精确筛选，每页5条、页码1至10。无库存不代表商品不存在；不创建订单或修改库存。',
      schema: productSkuLookupSchema,
    },
  );
}
