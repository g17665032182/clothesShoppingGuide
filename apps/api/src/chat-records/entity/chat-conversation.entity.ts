import { randomUUID } from 'node:crypto';

import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'chat_conversations' })
export class ChatConversation {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'user_id' })
  public userId!: string;

  @Property({ type: 'string', length: 200 })
  public title!: string;

  @Property({ type: 'text', fieldName: 'context_summary', nullable: true })
  public contextSummary: string | null = null;

  @Property({
    type: 'uuid',
    fieldName: 'summary_through_message_id',
    nullable: true,
  })
  public summaryThroughMessageId: string | null = null;

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
