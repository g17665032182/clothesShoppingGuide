export type ProductSkuResponse = {
  skuId: string;
  productExternalId: string;
  productName: string;
  color: string;
  size: string;
  unitPrice: string;
  currency: 'CNY';
  inStock: boolean;
  imageUrl: string | null;
};

export type ProductSkuPageResponse = {
  items: ProductSkuResponse[];
  total: number;
  page: number;
  pageSize: number;
};
