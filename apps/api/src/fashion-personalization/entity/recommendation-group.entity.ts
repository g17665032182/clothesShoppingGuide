import { randomUUID } from 'node:crypto';

import {
  Entity,
  Index,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'recommendation_groups' })
@Index({
  name: 'recommendation_groups_user_created_index',
  properties: ['userId', 'createdAt', 'id'],
})
@Index({
  name: 'recommendation_groups_conversation_index',
  properties: ['conversationId', 'assistantMessageId'],
})
export class RecommendationGroup {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'user_id' })
  public userId!: string;

  @Property({ type: 'uuid', fieldName: 'conversation_id' })
  public conversationId!: string;

  @Property({ type: 'uuid', fieldName: 'assistant_message_id', unique: true })
  public assistantMessageId!: string;

  @Property({ type: 'json', fieldName: 'intent_snapshot' })
  public intentSnapshot!: Record<string, unknown>;

  @Property({ type: 'json' })
  public targets!: Array<Record<string, unknown>>;

  @Property({ type: 'json', fieldName: 'source_snapshot' })
  public sourceSnapshot!: Array<Record<string, unknown>>;

  @Property({
    type: 'timestamptz',
    fieldName: 'created_at',
    onCreate: () => new Date(),
  })
  public createdAt: Date = new Date();

  @Property({ type: 'timestamptz', fieldName: 'expires_at', nullable: true })
  public expiresAt: Date | null = null;
}
