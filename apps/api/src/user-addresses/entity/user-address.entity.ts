import { randomUUID } from 'node:crypto';

import {
  Entity,
  Index,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'user_addresses' })
@Unique({
  name: 'user_addresses_user_request_key_unique',
  properties: ['userId', 'createRequestKey'],
})
@Index({
  name: 'user_addresses_user_updated_index',
  properties: ['userId', 'updatedAt', 'id'],
})
export class UserAddress {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'user_id' })
  public userId!: string;

  @Property({ type: 'string', fieldName: 'recipient_name', length: 100 })
  public recipientName!: string;

  @Property({ type: 'string', length: 21 })
  public phone!: string;

  @Property({ type: 'string', length: 500 })
  public address!: string;

  @Property({ type: 'string', length: 40, nullable: true })
  public label: string | null = null;

  @Property({ type: 'boolean', fieldName: 'is_default', default: false })
  public isDefault = false;

  @Property({ type: 'uuid', fieldName: 'create_request_key' })
  public createRequestKey!: string;

  @Property({
    type: 'timestamptz',
    fieldName: 'created_at',
    onCreate: () => new Date(),
  })
  public createdAt: Date = new Date();

  @Property({
    type: 'timestamptz',
    fieldName: 'updated_at',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  public updatedAt: Date = new Date();
}
