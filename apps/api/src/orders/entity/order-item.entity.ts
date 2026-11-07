import { randomUUID } from 'node:crypto';

import {
  Entity,
  Index,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'order_items' })
@Unique({
  name: 'order_items_order_sku_unique',
  properties: ['orderId', 'skuId'],
})
@Index({ name: 'order_items_sku_index', properties: ['skuId'] })
export class OrderItem {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'order_id' })
  public orderId!: string;

  @Property({ type: 'uuid', fieldName: 'sku_id' })
  public skuId!: string;

  @Property({
    type: 'string',
    fieldName: 'product_external_id',
    length: 160,
  })
  public productExternalId!: string;

  @Property({ type: 'string', fieldName: 'product_name', length: 200 })
  public productName!: string;

  @Property({ type: 'string', length: 32 })
  public color!: string;

  @Property({ type: 'string', length: 32 })
  public size!: string;

  @Property({
    type: 'string',
    fieldName: 'image_url',
    length: 2048,
    nullable: true,
  })
  public imageUrl: string | null = null;

  @Property({
    type: 'decimal',
    fieldName: 'unit_price',
    precision: 12,
    scale: 2,
  })
  public unitPrice!: string;

  @Property({ type: 'integer' })
  public quantity!: number;

  @Property({
    type: 'decimal',
    fieldName: 'line_amount',
    precision: 16,
    scale: 2,
  })
  public lineAmount!: string;
}
