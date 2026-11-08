import { ConflictException, Injectable } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/core';

import type {
  ProductCatalogOrderPort,
  ProductCatalogOrderQuantity,
  ProductCatalogOrderSku,
  ProductCatalogSkuIdentity,
  ProductCatalogSkuExternalKey,
} from './product-catalog-order.port.js';

type LockedSkuRow = {
  sku_id: string;
  product_external_id: string;
  external_sku_id: string;
  product_name: string;
  color: string;
  size: string;
  price: string;
  currency: string;
  stock: number;
  product_is_active: boolean;
  sku_is_active: boolean;
  image_url: string | null;
};

type ReservedSkuRow = {
  sku_id: string;
  reserved_quantity: string;
};

@Injectable()
export class ProductCatalogOrderService implements ProductCatalogOrderPort {
  public async lockSkus(
    entityManager: EntityManager,
    skuIds: string[],
  ): Promise<ProductCatalogOrderSku[]> {
    const uniqueSkuIds = [...new Set(skuIds)].sort();
    if (uniqueSkuIds.length === 0) return [];
    const transactionContext = this.requireTransaction(entityManager);
    const skuPlaceholders = uniqueSkuIds.map(() => '?').join(', ');
    await entityManager.getConnection().execute(
      `select s.id from product_skus s
       where s.id in (${skuPlaceholders})
       order by s.id asc
       for update of s`,
      uniqueSkuIds,
      'all',
      transactionContext,
    );
    // 等待 SKU 锁的语句可能保留旧的父商品快照，全部加锁后再读取当前投影。
    const rows = await entityManager.getConnection().execute<LockedSkuRow[]>(
      `select s.id::text as sku_id, p.external_id as product_external_id,
           s.external_sku_id, p.name as product_name, s.color, s.size, s.price::text as price,
           s.currency, s.stock, p.is_active as product_is_active,
           s.is_active as sku_is_active, s.image_url
         from product_skus s
         join products p on p.id = s.product_id
         where s.id in (${skuPlaceholders})
         order by s.id asc`,
      uniqueSkuIds,
      'all',
      transactionContext,
    );

    return rows.map((row: LockedSkuRow) => ({
      skuId: row.sku_id,
      productExternalId: row.product_external_id,
      externalSkuId: row.external_sku_id,
      productName: row.product_name,
      color: row.color,
      size: row.size,
      price: row.price,
      currency: row.currency,
      stock: row.stock,
      isProductActive: row.product_is_active,
      isSkuActive: row.sku_is_active,
      imageUrl: row.image_url,
    }));
  }

  public async getReservedQuantities(
    entityManager: EntityManager,
    skuIds: string[],
  ): Promise<Map<string, number>> {
    const uniqueSkuIds = [...new Set(skuIds)].sort();
    if (uniqueSkuIds.length === 0) return new Map();
    const skuPlaceholders = uniqueSkuIds.map(() => '?').join(', ');
    const rows = await entityManager.getConnection().execute<ReservedSkuRow[]>(
      `select sku_id::text as sku_id, reserved_quantity::text as reserved_quantity
         from active_order_sku_reservations
         where sku_id in (${skuPlaceholders})
         order by sku_id asc`,
      uniqueSkuIds,
      'all',
      this.requireTransaction(entityManager),
    );
    return new Map(
      rows.map((row: ReservedSkuRow) => [
        row.sku_id,
        Number(row.reserved_quantity),
      ]),
    );
  }

  public async decrementStockForShipment(
    entityManager: EntityManager,
    quantities: ProductCatalogOrderQuantity[],
  ): Promise<void> {
    const sortedQuantities = [...quantities].sort((left, right) =>
      left.skuId.localeCompare(right.skuId),
    );
    const transactionContext = this.requireTransaction(entityManager);
    for (const { skuId, quantity } of sortedQuantities) {
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new ConflictException('订单库存数量无效');
      }
      const rows = await entityManager
        .getConnection()
        .execute<Array<{ id: string }>>(
          `update product_skus
           set stock = stock - ?, updated_at = now()
           where id = ? and stock >= ?
           returning id::text as id`,
          [quantity, skuId, quantity],
          'all',
          transactionContext,
        );
      if (rows.length !== 1) {
        throw new ConflictException('商品库存状态已变化，请重试');
      }
    }
  }

  public async listSkuIdsForCatalogChanges(
    entityManager: EntityManager,
    productExternalIds: string[],
    skuExternalKeys: ProductCatalogSkuExternalKey[],
  ): Promise<string[]> {
    const identities = await this.getSkuIdsForCatalogChanges(
      entityManager,
      productExternalIds,
      skuExternalKeys,
    );
    return identities.map((identity) => identity.skuId);
  }

  public async getSkuIdsForCatalogChanges(
    entityManager: EntityManager,
    productExternalIds: string[],
    skuExternalKeys: ProductCatalogSkuExternalKey[],
  ): Promise<ProductCatalogSkuIdentity[]> {
    const uniqueProductIds = [...new Set(productExternalIds)].sort();
    const uniqueSkuKeys = [
      ...new Map(
        skuExternalKeys.map((key) => [
          `${key.productExternalId}\u0000${key.externalSkuId}`,
          key,
        ]),
      ).values(),
    ].sort(
      (left, right) =>
        left.productExternalId.localeCompare(right.productExternalId) ||
        left.externalSkuId.localeCompare(right.externalSkuId),
    );
    if (uniqueProductIds.length === 0 && uniqueSkuKeys.length === 0) return [];

    const clauses: string[] = [];
    const parameters: unknown[] = [];
    if (uniqueProductIds.length > 0) {
      clauses.push(
        `p.external_id in (${uniqueProductIds.map(() => '?').join(', ')})`,
      );
      parameters.push(...uniqueProductIds);
    }
    if (uniqueSkuKeys.length > 0) {
      clauses.push(
        `(${uniqueSkuKeys
          .map(() => '(p.external_id = ? and s.external_sku_id = ?)')
          .join(' or ')})`,
      );
      for (const key of uniqueSkuKeys) {
        parameters.push(key.productExternalId, key.externalSkuId);
      }
    }
    const rows = await entityManager.getConnection().execute<
      Array<{
        id: string;
        product_external_id: string;
        external_sku_id: string;
      }>
    >(
      `select s.id::text as id, p.external_id as product_external_id,
           s.external_sku_id
         from product_skus s
         join products p on p.id = s.product_id
         where ${clauses.join(' or ')}
         order by s.id asc`,
      parameters,
      'all',
      this.requireTransaction(entityManager),
    );
    return rows.map(
      (row: {
        id: string;
        product_external_id: string;
        external_sku_id: string;
      }) => ({
        skuId: row.id,
        productExternalId: row.product_external_id,
        externalSkuId: row.external_sku_id,
      }),
    );
  }

  private requireTransaction(entityManager: EntityManager) {
    const transactionContext = entityManager.getTransactionContext();
    if (!transactionContext) {
      throw new Error('商品订单库存操作必须加入调用方事务');
    }
    return transactionContext;
  }
}
