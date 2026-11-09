export type AdminProductCategory =
  'tops' | 'bottoms' | 'dresses' | 'outerwear' | 'shoes';

export type AdminProductQuery = {
  page: number;
  pageSize: number;
  keyword?: string;
  category?: AdminProductCategory;
  isActive?: boolean;
  inStock?: boolean;
};

export type AdminProductSummary = {
  id: string;
  externalId: string;
  name: string;
  brand: string | null;
  category: AdminProductCategory;
  productUrl: string | null;
  isActive: boolean;
  tryOnEnabled: boolean;
  skuCount: number;
  lowestPrice: string | null;
  totalStock: number;
  totalAvailableStock: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminProductListResponse = {
  items: AdminProductSummary[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminProductSku = {
  id: string;
  externalSkuId: string;
  color: string;
  size: string;
  price: string;
  currency: 'CNY';
  stock: number;
  reservedStock: number;
  availableStock: number;
  imageUrl: string | null;
  isActive: boolean;
};

export type AdminProductDetail = AdminProductSummary & {
  description: string | null;
  styles: string[];
  occasions: string[];
  fits: string[];
  skus: AdminProductSku[];
};
