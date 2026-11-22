import { randomUUID } from 'node:crypto';

import {
  Entity,
  Index,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'recommendation_feedback_events' })
@Index({
  name: 'recommendation_feedback_user_created_index',
  properties: ['userId', 'createdAt', 'id'],
})
@Index({
  name: 'recommendation_feedback_group_target_index',
  properties: ['recommendationId', 'targetType', 'targetRef'],
})
export class RecommendationFeedback {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'user_id' })
  public userId!: string;

  @Property({ type: 'uuid', fieldName: 'recommendation_id' })
  public recommendationId!: string;

  @Property({ type: 'uuid', fieldName: 'conversation_id' })
  public conversationId!: string;

  @Property({ type: 'uuid', fieldName: 'assistant_message_id' })
  public assistantMessageId!: string;

  @Property({ type: 'string', fieldName: 'target_type', length: 16 })
  public targetType!: string;

  @Property({ type: 'string', fieldName: 'target_ref', length: 160 })
  public targetRef!: string;

  @Property({ type: 'string', fieldName: 'feedback_type', length: 16 })
  public feedbackType!: string;

  @Property({
    type: 'string',
    fieldName: 'reason_code',
    length: 40,
    nullable: true,
  })
  public reasonCode: string | null = null;

  @Property({ type: 'text', nullable: true })
  public note: string | null = null;

  @Property({ type: 'json', fieldName: 'request_snapshot' })
  public requestSnapshot!: Record<string, unknown>;

  @Property({ type: 'json', fieldName: 'target_snapshot', nullable: true })
  public targetSnapshot: Record<string, unknown> | null = null;

  @Property({
    type: 'string',
    fieldName: 'idempotency_key',
    length: 64,
    unique: true,
  })
  public idempotencyKey!: string;

  @Property({
    type: 'timestamptz',
    fieldName: 'created_at',
    onCreate: () => new Date(),
  })
  public createdAt: Date = new Date();
}
