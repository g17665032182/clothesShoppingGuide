import { randomUUID } from 'node:crypto';

import {
  Entity,
  Enum,
  Index,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';

export enum ChatTraceEventType {
  INPUT = 'input',
  MODEL_RESPONSE = 'model_response',
  TOOL_CALL = 'tool_call',
  TOOL_RESULT = 'tool_result',
}

export enum ChatTraceEventStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
  PARTIAL = 'partial',
}

@Entity({ tableName: 'chat_trace_events' })
@Index({
  name: 'chat_trace_events_conversation_created_sequence_index',
  properties: ['conversationId', 'createdAt', 'sequence'],
})
@Index({
  name: 'chat_trace_events_conversation_tool_call_index',
  properties: ['conversationId', 'toolCallId'],
})
@Index({
  name: 'chat_trace_events_run_sequence_unique',
  properties: ['conversationId', 'runId', 'sequence'],
  options: { unique: true },
})
export class ChatTraceEvent {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'conversation_id' })
  public conversationId!: string;

  @Property({ type: 'uuid', fieldName: 'run_id' })
  public runId!: string;

  @Property({ type: 'integer' })
  public sequence!: number;

  @Enum({ items: () => ChatTraceEventType, fieldName: 'event_type' })
  public eventType!: ChatTraceEventType;

  @Property({ type: 'text', fieldName: 'message_id', nullable: true })
  public messageId: string | null = null;

  @Property({ type: 'text', fieldName: 'tool_call_id', nullable: true })
  public toolCallId: string | null = null;

  @Property({
    type: 'string',
    length: 200,
    fieldName: 'tool_name',
    nullable: true,
  })
  public toolName: string | null = null;

  @Property({ type: 'text', nullable: true })
  public content: string | null = null;

  @Property({ type: 'json', nullable: true })
  public payload: Record<string, unknown> | unknown[] | null = null;

  @Enum({ items: () => ChatTraceEventStatus, nullable: true })
  public status: ChatTraceEventStatus | null = null;

  @Property({ type: 'string', length: 100, nullable: true })
  public model: string | null = null;

  @Property({ type: 'json', nullable: true })
  public usage: Record<string, unknown> | null = null;

  @Property({
    type: 'timestamptz',
    fieldName: 'created_at',
    onCreate: () => new Date(),
  })
  public createdAt: Date = new Date();
}
