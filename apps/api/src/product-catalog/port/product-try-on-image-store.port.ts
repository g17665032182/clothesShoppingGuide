export const PRODUCT_TRY_ON_IMAGE_STORE = Symbol('PRODUCT_TRY_ON_IMAGE_STORE');

/** 商品私有图独立于人像与生成结果，任务只通过此端口读取已保存的快照。 */
export interface ProductTryOnImageStore {
  putImage(input: {
    productId: string;
    assetId: string;
    body: Buffer;
  }): Promise<string>;
  getObject(objectKey: string): Promise<Buffer>;
  deleteObject(objectKey: string): Promise<void>;
}
