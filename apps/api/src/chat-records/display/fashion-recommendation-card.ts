import { z } from 'zod';

const recommendationItemSchema = z.strictObject({
  targetRef: z.string().trim().min(1).max(160),
  sourceId: z.string().trim().min(1).max(80),
  sourceType: z.enum(['local_catalog', 'online_api', 'mcp']),
  sourceName: z.string().trim().min(1).max(120),
  externalId: z.string().trim().min(1).max(160),
  slot: z.enum(['tops', 'bottoms', 'dresses', 'outerwear', 'shoes']),
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(100).nullable(),
  imageUrl: z.string().trim().max(2048).nullable(),
  productUrl: z.string().trim().max(2048).nullable(),
  price: z
    .string()
    .regex(/^\d{1,10}\.\d{2}$/u)
    .nullable(),
  currency: z.literal('CNY').nullable(),
  inStock: z.boolean(),
  observedAt: z.iso.datetime({ offset: true }),
  matchReasons: z.array(z.string().trim().min(1).max(80)).max(9),
});

const outfitItemSchema = z.strictObject({
  slot: z.enum(['tops', 'bottoms', 'dresses', 'outerwear', 'shoes']),
  targetRef: z.string().trim().min(1).max(160),
  item: recommendationItemSchema,
});

const outfitSchema = z.strictObject({
  outfitRef: z.string().trim().min(1).max(160),
  styleSummary: z.string().trim().min(1).max(500),
  items: z.array(outfitItemSchema).min(1).max(4),
  total: z
    .strictObject({
      amount: z.string().regex(/^\d{1,10}\.\d{2}$/u),
      currency: z.literal('CNY'),
    })
    .nullable(),
  missingSlots: z
    .array(z.enum(['tops', 'bottoms', 'dresses', 'outerwear', 'shoes']))
    .max(5),
});

export const fashionRecommendationCardSchema = z.strictObject({
  type: z.literal('card'),
  name: z.literal('outfit_recommendation'),
  data: z.strictObject({
    version: z.literal(1),
    recommendationId: z.uuid(),
    mode: z.enum(['item', 'outfit', 'both']),
    styleSummary: z.string().trim().min(1).max(500),
    items: z.array(recommendationItemSchema).max(6),
    outfits: z.array(outfitSchema).max(2),
  }),
});

export type FashionRecommendationCard = z.infer<
  typeof fashionRecommendationCardSchema
>;

/**
 * 历史消息和 SSE 都经过同一份白名单校验；不认识的新版本直接忽略，
 * 这样新增卡片协议不会让旧客户端误把任意 JSON 当成商品事实。
 */
export function restoreFashionRecommendationCard(
  value: unknown,
): FashionRecommendationCard | null {
  const parsed = fashionRecommendationCardSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
