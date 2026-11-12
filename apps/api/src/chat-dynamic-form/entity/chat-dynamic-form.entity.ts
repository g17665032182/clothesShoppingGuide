import { randomUUID } from 'node:crypto';

import {
  Entity,
  Index,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';

import type {
  DynamicFormDefinition,
  DynamicFormResultReference,
  DynamicFormStatus,
} from '../dto/chat-dynamic-form-response.js';

@Entity({ tableName: 'chat_dynamic_forms' })
@Index({
  name: 'chat_dynamic_forms_user_conversation_created_index',
  properties: ['userId', 'conversationId', 'createdAt', 'id'],
})
@Index({
  name: 'chat_dynamic_forms_conversation_message_index',
  properties: ['conversationId', 'assistantMessageId'],
})
export class ChatDynamicForm {
  @PrimaryKey({ type: 'uuid' })
  public id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'user_id' })
  public userId!: string;

  @Property({ type: 'uuid', fieldName: 'conversation_id' })
  public conversationId!: string;

  @Property({ type: 'uuid', fieldName: 'run_id' })
  public runId!: string;

  @Property({
    type: 'uuid',
    fieldName: 'assistant_message_id',
    nullable: true,
  })
  public assistantMessageId: string | null = null;

  @Property({ type: 'string', length: 80, fieldName: 'form_kind' })
  public formKind!: string;

  @Property({ type: 'integer' })
  public revision = 1;

  @Property({ type: 'json' })
  public definition!: DynamicFormDefinition;

  @Property({ type: 'json', fieldName: 'handler_context' })
  public handlerContext: Record<string, string | number> = {};

  @Property({ type: 'string', length: 20 })
  public status: DynamicFormStatus = 'open';

  @Property({ type: 'json', nullable: true, fieldName: 'result_reference' })
  public resultReference: DynamicFormResultReference | null = null;

  @Property({
    type: 'string',
    length: 64,
    nullable: true,
    fieldName: 'submission_fingerprint',
  })
  public submissionFingerprint: string | null = null;

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

  @Property({ type: 'timestamptz', fieldName: 'expires_at' })
  public expiresAt!: Date;
}
