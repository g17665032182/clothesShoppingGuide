import { randomUUID } from 'node:crypto';

import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'order_idempotency' })
@Unique({
  name: 'order_idempotency_user_key_unique',
  properties: ['userId', 'idempotencyKey'],
})
@Unique({
  name: 'order_idempotency_order_unique',
  properties: ['orderId'],
})
export class OrderIdempotency {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'user_id' })
  public userId!: string;

  @Property({ type: 'uuid', fieldName: 'idempotency_key' })
  public idempotencyKey!: string;

  @Property({
    type: 'string',
    fieldName: 'request_hash',
    length: 64,
  })
  public requestHash!: string;

  @Property({ type: 'uuid', fieldName: 'order_id' })
  public orderId!: string;

  @Property({
    type: 'timestamptz',
    fieldName: 'created_at',
    onCreate: () => new Date(),
  })
  public createdAt = new Date();
}
