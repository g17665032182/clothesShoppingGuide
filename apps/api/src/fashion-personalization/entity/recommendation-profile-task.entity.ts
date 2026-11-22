import { randomUUID } from 'node:crypto';

import {
  Entity,
  Enum,
  Index,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';

export enum RecommendationProfileTaskStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
}

@Entity({ tableName: 'recommendation_profile_tasks' })
@Index({
  name: 'recommendation_profile_tasks_claim_index',
  properties: ['status', 'availableAt', 'createdAt'],
})
@Index({
  name: 'recommendation_profile_tasks_user_index',
  properties: ['userId', 'createdAt'],
})
export class RecommendationProfileTask {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'user_id' })
  public userId!: string;

  @Property({ type: 'integer', default: 0 })
  public generation = 0;

  @Enum({ items: () => RecommendationProfileTaskStatus })
  public status = RecommendationProfileTaskStatus.PENDING;

  @Property({ type: 'integer', default: 0 })
  public attempts = 0;

  @Property({ type: 'timestamptz', fieldName: 'available_at' })
  public availableAt: Date = new Date();

  @Property({ type: 'timestamptz', fieldName: 'locked_at', nullable: true })
  public lockedAt: Date | null = null;

  @Property({ type: 'uuid', fieldName: 'lock_token', nullable: true })
  public lockToken: string | null = null;

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
