import { randomUUID } from 'node:crypto';

import {
  Entity,
  Index,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'products' })
@Unique({ name: 'products_external_id_unique', properties: ['externalId'] })
@Index({
  name: 'products_active_category_index',
  properties: ['isActive', 'category'],
})
export class Product {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'string', fieldName: 'external_id', length: 160 })
  public externalId!: string;

  @Property({ type: 'string', length: 200 })
  public name!: string;

  @Property({ type: 'string', length: 100, nullable: true })
  public brand: string | null = null;

  @Property({ type: 'string', length: 32 })
  public category!: string;

  @Property({ type: 'text', nullable: true })
  public description: string | null = null;

  @Property({ type: 'json', default: '[]' })
  public styles: string[] = [];

  @Property({ type: 'json', default: '[]' })
  public occasions: string[] = [];

  @Property({ type: 'json', default: '[]' })
  public fits: string[] = [];

  @Property({ type: 'string', length: 16, default: 'adult' })
  public audience = 'adult';

  @Property({
    type: 'string',
    fieldName: 'product_url',
    length: 2048,
    nullable: true,
  })
  public productUrl: string | null = null;

  @Property({ type: 'boolean', fieldName: 'is_active', default: true })
  public isActive = true;

  @Property({ type: 'boolean', fieldName: 'try_on_enabled', default: false })
  public tryOnEnabled = false;

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
