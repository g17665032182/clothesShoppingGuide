import { randomUUID } from 'node:crypto';

import {
  Entity,
  Enum,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';

export enum ChatRecordMessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
}

@Entity({ tableName: 'chat_messages' })
export class ChatMessage {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'conversation_id' })
  public conversationId!: string;

  @Enum({ items: () => ChatRecordMessageRole })
  public role!: ChatRecordMessageRole;

  @Property({ type: 'text' })
  public content!: string;

  @Property({ type: 'string', length: 100, nullable: true })
  public model: string | null = null;

  @Property({ type: 'integer', fieldName: 'input_tokens', nullable: true })
  public inputTokens: number | null = null;

  @Property({ type: 'integer', fieldName: 'output_tokens', nullable: true })
  public outputTokens: number | null = null;

  @Property({ type: 'integer', fieldName: 'total_tokens', nullable: true })
  public totalTokens: number | null = null;

  @Property({
    type: 'timestamptz',
    fieldName: 'created_at',
    onCreate: () => new Date(),
  })
  public createdAt: Date = new Date();
}
