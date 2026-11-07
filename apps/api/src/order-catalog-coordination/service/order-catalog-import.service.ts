import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { MikroORM, type EntityManager } from '@mikro-orm/core';

import {
  PRODUCT_CATALOG_ORDER_PORT,
  ProductCatalogImportService as ProductImportService,
  type ProductCatalogImport,
  type ProductCatalogImportResult,
  type ProductCatalogOrderPort,
} from '../../product-catalog/index.js';
import {
  ORDER_CATALOG_IMPORT_PORT,
  UnavailableOrderLockSetChangedError,
  type OrderCatalogImportPort,
  type UnavailableOrderLockSet,
} from '../../orders/index.js';

const MAX_LOCK_SET_RETRIES = 3;

@Injectable()
export class OrderCatalogImportService {
  public constructor(
    @Inject(MikroORM) private readonly orm: MikroORM,
    @Inject(PRODUCT_CATALOG_ORDER_PORT)
    private readonly catalog: ProductCatalogOrderPort,
    @Inject(ORDER_CATALOG_IMPORT_PORT)
    private readonly orders: OrderCatalogImportPort,
    @Inject(ProductImportService)
    private readonly productImport: ProductImportService,
  ) {}

  public async import(
    products: ProductCatalogImport['products'],
  ): Promise<ProductCatalogImportResult> {
    const allProductExternalIds = products.map((product) => product.externalId);
    const allSkuKeys = products.flatMap((product) =>
      product.skus.map((sku) => ({
        productExternalId: product.externalId,
        externalSkuId: sku.externalSkuId,
      })),
    );
    const unavailableProductIds = products
      .filter((product) => !product.isActive)
      .map((product) => product.externalId);
    const unavailableSkuKeys = products.flatMap((product) =>
      product.skus
        .filter((sku) => !sku.isActive)
        .map((sku) => ({
          productExternalId: product.externalId,
          externalSkuId: sku.externalSkuId,
        })),
    );

    // 新增订单可能扩展关闭范围；锁集合变化时必须回滚整笔事务后再重试。
    for (let attempt = 0; attempt < MAX_LOCK_SET_RETRIES; attempt += 1) {
      const entityManager = this.orm.em.fork();
      try {
        return await entityManager.transactional(async (transaction) => {
          await this.lockCatalogImport(transaction);
          return this.importInTransaction(transaction, {
            products,
            allProductExternalIds,
            allSkuKeys,
            unavailableProductIds,
            unavailableSkuKeys,
          });
        });
      } catch (error) {
        if (!isLockSetChanged(error)) throw error;
        if (attempt === MAX_LOCK_SET_RETRIES - 1)
          throw new ConflictException('商品目录并发变更，请重新提交导入文件');
      }
    }
    throw new ConflictException('商品目录并发变更，请重新提交导入文件');
  }

  private async importInTransaction(
    transaction: EntityManager,
    input: {
      products: ProductCatalogImport['products'];
      allProductExternalIds: string[];
      allSkuKeys: Array<{
        productExternalId: string;
        externalSkuId: string;
      }>;
      unavailableProductIds: string[];
      unavailableSkuKeys: Array<{
        productExternalId: string;
        externalSkuId: string;
      }>;
    },
  ): Promise<ProductCatalogImportResult> {
    // 先预读完整订单 SKU 集合，再一次性加锁，避免拿到订单锁后反向补 SKU 锁。
    const identities = await this.catalog.getSkuIdsForCatalogChanges(
      transaction,
      input.allProductExternalIds,
      input.allSkuKeys,
    );
    const changedSkuIds = await this.catalog.listSkuIdsForCatalogChanges(
      transaction,
      input.unavailableProductIds,
      input.unavailableSkuKeys,
    );
    const initialLockSet = await this.orders.getUnavailableOrderLockSet(
      transaction,
      changedSkuIds,
    );
    const lockedSkuIds = [
      ...new Set([
        ...identities.map((identity) => identity.skuId),
        ...initialLockSet.skuIds,
      ]),
    ].sort((left, right) => left.localeCompare(right));
    const snapshots = await this.catalog.lockSkus(transaction, lockedSkuIds);
    const snapshotByKey = new Map(
      snapshots.map((snapshot) => [
        this.skuKey(snapshot.productExternalId, snapshot.externalSkuId),
        snapshot,
      ]),
    );
    const lockedSet = new Set(lockedSkuIds);

    const currentLockSet = await this.orders.getUnavailableOrderLockSet(
      transaction,
      changedSkuIds,
    );
    this.assertLockSetCovered(currentLockSet, lockedSet);
    await this.orders.closePendingOrdersForUnavailableSkus(
      transaction,
      changedSkuIds,
      lockedSkuIds,
    );

    await transaction.flush();
    const reservations = await this.catalog.getReservedQuantities(
      transaction,
      identities.map((identity) => identity.skuId),
    );
    const identityByKey = new Map(
      identities.map((identity) => [
        this.skuKey(identity.productExternalId, identity.externalSkuId),
        identity,
      ]),
    );

    for (const product of input.products) {
      for (const sku of product.skus) {
        const key = this.skuKey(product.externalId, sku.externalSkuId);
        const identity = identityByKey.get(key);
        if (!identity) continue;
        const snapshot = snapshotByKey.get(key);
        if (!snapshot)
          throw new ConflictException('商品规格在导入过程中发生变化');
        const reserved = reservations.get(identity.skuId) ?? 0;
        if (sku.stock < reserved) {
          throw new ConflictException(
            `商品 ${product.externalId} 的规格 ${sku.externalSkuId} 库存低于当前预占量`,
          );
        }
      }
    }

    return this.productImport.upsertInTransaction(transaction, input.products);
  }

  private assertLockSetCovered(
    lockSet: UnavailableOrderLockSet,
    lockedSkuIds: Set<string>,
  ): void {
    if (lockSet.skuIds.some((skuId) => !lockedSkuIds.has(skuId)))
      throw new UnavailableOrderLockSetChangedError();
  }

  private async lockCatalogImport(transaction: EntityManager): Promise<void> {
    const transactionContext = transaction.getTransactionContext();
    if (!transactionContext)
      throw new Error('商品目录导入需要处于数据库事务中');
    await transaction
      .getConnection()
      .execute(
        'select pg_advisory_xact_lock(hashtextextended(?, 0))',
        ['product-catalog-import'],
        'run',
        transactionContext,
      );
  }

  private skuKey(productExternalId: string, externalSkuId: string): string {
    return `${productExternalId}\u0000${externalSkuId}`;
  }
}

function isLockSetChanged(
  error: unknown,
): error is UnavailableOrderLockSetChangedError {
  return error instanceof UnavailableOrderLockSetChangedError;
}
