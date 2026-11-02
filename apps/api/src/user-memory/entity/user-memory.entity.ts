import { randomUUID } from 'node:crypto';

import {
  Entity,
  Enum,
  Index,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';

import type {
  MemoryCategory,
  MemoryValue,
  MemoryValueType,
} from '../context/memory-value.schema.js';

export enum UserMemoryStatus {
  ACTIVE = 'active',
  DELETED = 'deleted',
}

export enum UserMemorySourceStatus {
  ACTIVE = 'active',
  DELETED = 'deleted',
  UNAVAILABLE = 'unavailable',
}

@Entity({ tableName: 'user_memories' })
@Index({
  name: 'user_memories_user_status_updated_index',
  properties: ['userId', 'status', 'updatedAt'],
})
@Index({
  name: 'user_memories_user_category_index',
  properties: ['userId', 'category', 'status'],
})
@Index({
  name: 'user_memories_source_conversation_index',
  properties: ['sourceConversationId'],
})
export class UserMemory {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'user_id' })
  public userId!: string;

  @Property({ type: 'string' })
  public category!: MemoryCategory;

  @Property({ type: 'string', fieldName: 'value_type' })
  public valueType!: MemoryValueType;

  @Property({ type: 'json', fieldName: 'value' })
  public value!: MemoryValue;

  @Property({ type: 'string', fieldName: 'value_fingerprint', length: 128 })
  public valueFingerprint!: string;

  @Property({ type: 'boolean', fieldName: 'is_primary', default: false })
  public isPrimary = false;

  @Enum({ items: () => UserMemoryStatus, default: UserMemoryStatus.ACTIVE })
  public status = UserMemoryStatus.ACTIVE;

  @Property({
    type: 'uuid',
    fieldName: 'source_conversation_id',
    nullable: true,
  })
  public sourceConversationId: string | null = null;

  @Enum({
    items: () => UserMemorySourceStatus,
    fieldName: 'source_status',
    nullable: true,
  })
  public sourceStatus: UserMemorySourceStatus | null = null;

  @Property({ type: 'timestamptz', fieldName: 'deleted_at', nullable: true })
  public deletedAt: Date | null = null;

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
