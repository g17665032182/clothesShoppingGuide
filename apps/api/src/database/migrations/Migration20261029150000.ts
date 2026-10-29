import { Migration } from '@mikro-orm/migrations';

export class Migration20261029150000 extends Migration {
  override name = 'Migration20261029150000';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "chat_trace_events" ("id" uuid not null, "conversation_id" uuid not null, "run_id" uuid not null, "sequence" int not null, "event_type" text not null, "message_id" text null, "tool_call_id" text null, "tool_name" varchar(200) null, "content" text null, "payload" jsonb null, "status" text null, "model" varchar(100) null, "usage" jsonb null, "created_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(
      `create unique index "chat_trace_events_run_sequence_unique" on "chat_trace_events" ("conversation_id", "run_id", "sequence");`,
    );
    this.addSql(
      `create index "chat_trace_events_conversation_created_sequence_index" on "chat_trace_events" ("conversation_id", "created_at", "sequence");`,
    );
    this.addSql(
      `create index "chat_trace_events_conversation_tool_call_index" on "chat_trace_events" ("conversation_id", "tool_call_id");`,
    );
    this.addSql(
      `alter table "chat_trace_events" add constraint "chat_trace_events_event_type_check" check ("event_type" in ('input', 'model_response', 'tool_call', 'tool_result'));`,
    );
    this.addSql(
      `alter table "chat_trace_events" add constraint "chat_trace_events_status_check" check ("status" is null or "status" in ('success', 'failed', 'partial'));`,
    );
    this.addSql(
      `alter table "chat_trace_events" add constraint "chat_trace_events_conversation_id_foreign" foreign key ("conversation_id") references "chat_conversations" ("id") on update cascade on delete cascade;`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql('drop table if exists "chat_trace_events" cascade;');
  }
}
