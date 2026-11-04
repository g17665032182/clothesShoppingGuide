import { randomUUID } from 'node:crypto';

import {
  Entity,
  Enum,
  Index,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import type { PreferenceOperation } from '../context/preference-candidate.schema.js';

export enum UserPreferenceTaskStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
}

@Entity({ tableName: 'user_preference_tasks' })
@Index({
  name: 'user_preference_tasks_claim_index',
  properties: ['status', 'availableAt', 'createdAt'],
})
@Index({
  name: 'user_preference_tasks_user_index',
  properties: ['userId', 'createdAt'],
})
export class UserPreferenceTask {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'user_id' })
  public userId!: string;

  @Property({ type: 'uuid', fieldName: 'conversation_id', nullable: true })
  public conversationId: string | null = null;

  @Property({ type: 'uuid', fieldName: 'user_message_id', nullable: true })
  public userMessageId: string | null = null;

  @Property({ type: 'uuid', fieldName: 'assistant_message_id', nullable: true })
  public assistantMessageId: string | null = null;

  @Property({ type: 'json', fieldName: 'candidate_operations', nullable: true })
  public candidateOperations: PreferenceOperation[] | null = null;

  @Property({
    type: 'string',
    fieldName: 'deduplication_key',
    length: 180,
    unique: true,
  })
  public deduplicationKey!: string;

  @Enum({ items: () => UserPreferenceTaskStatus })
  public status = UserPreferenceTaskStatus.PENDING;

  @Property({ type: 'integer', default: 0 })
  public attempts = 0;

  @Property({ type: 'timestamptz', fieldName: 'available_at' })
  public availableAt: Date = new Date();

  @Property({ type: 'timestamptz', fieldName: 'locked_at', nullable: true })
  public lockedAt: Date | null = null;

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
  public createdAt: Date = new Date();

  @Property({
    type: 'timestamptz',
    fieldName: 'updated_at',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  public updatedAt: Date = new Date();
}
