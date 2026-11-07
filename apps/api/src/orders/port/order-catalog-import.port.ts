import type { EntityManager } from '@mikro-orm/core';

export const ORDER_CATALOG_IMPORT_PORT = Symbol('ORDER_CATALOG_IMPORT_PORT');

export type UnavailableOrderLockSet = {
  orderIds: string[];
  skuIds: string[];
};

export class UnavailableOrderLockSetChangedError extends Error {
  public constructor() {
    super('商品目录锁集合已变化，请重试导入');
    this.name = UnavailableOrderLockSetChangedError.name;
  }
}

export interface OrderCatalogImportPort {
  getUnavailableOrderLockSet(
    entityManager: EntityManager,
    changedSkuIds: string[],
  ): Promise<UnavailableOrderLockSet>;

  closePendingOrdersForUnavailableSkus(
    entityManager: EntityManager,
    changedSkuIds: string[],
    lockedSkuIds: string[],
  ): Promise<number>;
}
