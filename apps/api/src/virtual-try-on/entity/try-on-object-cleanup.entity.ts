import { randomUUID } from 'node:crypto';
import {
  Entity,
  Index,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'try_on_object_cleanups' })
@Index({
  name: 'try_on_object_cleanups_due_index',
  properties: ['nextAttemptAt', 'createdAt'],
})
@Unique({
  name: 'try_on_object_cleanups_object_key_unique',
  properties: ['objectKey'],
})
export class TryOnObjectCleanup {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'user_id', nullable: true })
  public userId: string | null = null;

  @Property({ type: 'string', fieldName: 'object_key', length: 512 })
  public objectKey!: string;

  @Property({ type: 'integer', default: 0 })
  public attempts = 0;

  @Property({ type: 'timestamptz', fieldName: 'next_attempt_at' })
  public nextAttemptAt = new Date();

  @Property({
    type: 'string',
    fieldName: 'last_error_code',
    length: 80,
    nullable: true,
  })
  public lastErrorCode: string | null = null;

  @Property({
    type: 'timestamptz',
    fieldName: 'created_at',
    onCreate: () => new Date(),
  })
  public createdAt = new Date();
}
