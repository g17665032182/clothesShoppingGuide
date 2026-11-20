import { randomUUID } from 'node:crypto';

import {
  Entity,
  Index,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'return_refund_events' })
@Index({
  name: 'return_refund_events_application_created_index',
  properties: ['applicationId', 'createdAt', 'id'],
})
export class ReturnRefundEvent {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'application_id' })
  public applicationId!: string;

  @Property({ type: 'string', length: 48 })
  public action!: string;

  @Property({
    type: 'string',
    fieldName: 'from_status',
    length: 32,
    nullable: true,
  })
  public fromStatus: string | null = null;

  @Property({ type: 'string', fieldName: 'to_status', length: 32 })
  public toStatus!: string;

  @Property({ type: 'uuid', fieldName: 'actor_user_id', nullable: true })
  public actorUserId: string | null = null;

  @Property({ type: 'string', fieldName: 'actor_role', length: 16 })
  public actorRole!: string;

  @Property({
    type: 'timestamptz',
    fieldName: 'created_at',
    onCreate: () => new Date(),
  })
  public createdAt = new Date();
}
