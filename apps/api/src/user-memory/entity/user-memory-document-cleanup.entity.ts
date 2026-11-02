import { randomUUID } from 'node:crypto';

import {
  Entity,
  Index,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'user_memory_document_cleanups' })
@Index({
  name: 'user_memory_document_cleanups_due_index',
  properties: ['nextAttemptAt', 'createdAt'],
})
export class UserMemoryDocumentCleanup {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({
    type: 'string',
    fieldName: 'object_key',
    length: 512,
    unique: true,
  })
  public objectKey!: string;

  @Property({ type: 'uuid', fieldName: 'user_id', nullable: true })
  public userId: string | null = null;

  @Property({ type: 'integer', default: 0 })
  public attempts = 0;

  @Property({ type: 'timestamptz', fieldName: 'next_attempt_at' })
  public nextAttemptAt = new Date();

  @Property({
    type: 'timestamptz',
    fieldName: 'created_at',
    onCreate: () => new Date(),
  })
  public createdAt = new Date();
}
