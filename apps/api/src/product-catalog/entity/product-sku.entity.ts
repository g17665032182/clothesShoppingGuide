import { randomUUID } from 'node:crypto';

import {
  Entity,
  Index,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'product_skus' })
@Unique({
  name: 'product_skus_product_external_id_unique',
  properties: ['productId', 'externalSkuId'],
})
@Index({
  name: 'product_skus_product_active_index',
  properties: ['productId', 'isActive'],
})
export class ProductSku {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'product_id' })
  public productId!: string;

  @Property({ type: 'string', fieldName: 'external_sku_id', length: 160 })
  public externalSkuId!: string;

  @Property({ type: 'string', length: 32 })
  public color!: string;

  @Property({ type: 'string', length: 32 })
  public size!: string;

  @Property({ type: 'decimal', precision: 12, scale: 2 })
  public price!: string;

  @Property({ type: 'string', length: 3, default: 'CNY' })
  public currency = 'CNY';

  @Property({ type: 'integer' })
  public stock!: number;

  @Property({
    type: 'string',
    fieldName: 'image_url',
    length: 2048,
    nullable: true,
  })
  public imageUrl: string | null = null;

  @Property({ type: 'boolean', fieldName: 'is_active', default: true })
  public isActive = true;

  @Property({
    type: 'timestamptz',
    fieldName: 'created_at',
    onCreate: () => new Date(),
  })
  public createdAt = new Date();

  @Property({
    type: 'timestamptz',
    fieldName: 'updated_at',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  public updatedAt = new Date();
}
