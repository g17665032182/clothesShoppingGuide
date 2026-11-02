import { Migration } from '@mikro-orm/migrations';

export class Migration20261103120000 extends Migration {
  override name = 'Migration20261103120000';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "user_memory_settings" ("user_id" uuid not null, "enabled" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("user_id"));`,
    );
    this.addSql(
      `alter table "user_memory_settings" add constraint "user_memory_settings_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`,
    );

    this.addSql(
      `create table "user_memories" ("id" uuid not null, "user_id" uuid not null, "category" text not null, "value_type" text not null, "value" jsonb not null, "value_fingerprint" varchar(128) not null, "is_primary" boolean not null default false, "status" text not null default 'active', "source_conversation_id" uuid null, "source_status" text null, "deleted_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(
      `create index "user_memories_user_status_updated_index" on "user_memories" ("user_id", "status", "updated_at" desc);`,
    );
    this.addSql(
      `create index "user_memories_user_category_index" on "user_memories" ("user_id", "category", "status");`,
    );
    this.addSql(
      `create index "user_memories_source_conversation_index" on "user_memories" ("source_conversation_id");`,
    );
    this.addSql(
      `create unique index "user_memories_user_category_fingerprint_active_unique" on "user_memories" ("user_id", "category", "value_fingerprint") where "status" = 'active';`,
    );
    this.addSql(
      `alter table "user_memories" add constraint "user_memories_category_check" check ("category" in ('size', 'shoe_size', 'fit', 'style', 'color', 'occasion', 'budget', 'avoidance', 'purchase_preference'));`,
    );
    this.addSql(
      `alter table "user_memories" add constraint "user_memories_value_type_check" check ("value_type" in ('single', 'multi', 'range'));`,
    );
    this.addSql(
      `alter table "user_memories" add constraint "user_memories_status_check" check ("status" in ('active', 'deleted'));`,
    );
    this.addSql(
      `alter table "user_memories" add constraint "user_memories_source_status_check" check ("source_status" is null or "source_status" in ('active', 'deleted', 'unavailable'));`,
    );
    this.addSql(
      `alter table "user_memories" add constraint "user_memories_source_required_check" check ("source_conversation_id" is null or "source_status" is not null);`,
    );
    this.addSql(
      `alter table "user_memories" add constraint "user_memories_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "user_memories" add constraint "user_memories_source_conversation_id_foreign" foreign key ("source_conversation_id") references "chat_conversations" ("id") on update cascade on delete set null;`,
    );

    this.addSql(
      `create table "user_memory_tasks" ("id" uuid not null, "user_id" uuid not null, "conversation_id" uuid null, "user_message_id" uuid null, "assistant_message_id" uuid null, "deduplication_key" varchar(180) not null, "status" text not null default 'pending', "attempts" int not null default 0, "available_at" timestamptz not null, "locked_at" timestamptz null, "last_error_code" varchar(80) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(
      `create unique index "user_memory_tasks_deduplication_key_unique" on "user_memory_tasks" ("deduplication_key");`,
    );
    this.addSql(
      `create index "user_memory_tasks_claim_index" on "user_memory_tasks" ("status", "available_at", "created_at");`,
    );
    this.addSql(
      `create index "user_memory_tasks_user_index" on "user_memory_tasks" ("user_id", "created_at" desc);`,
    );
    this.addSql(
      `alter table "user_memory_tasks" add constraint "user_memory_tasks_status_check" check ("status" in ('pending', 'processing', 'succeeded', 'failed'));`,
    );
    this.addSql(
      `alter table "user_memory_tasks" add constraint "user_memory_tasks_attempts_check" check ("attempts" >= 0);`,
    );
    this.addSql(
      `alter table "user_memory_tasks" add constraint "user_memory_tasks_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "user_memory_tasks" add constraint "user_memory_tasks_conversation_id_foreign" foreign key ("conversation_id") references "chat_conversations" ("id") on update cascade on delete set null;`,
    );

    this.addSql(
      `create table "user_memory_task_results" ("id" uuid not null, "task_id" uuid not null, "operation_key" varchar(180) not null, "action" text not null, "memory_id" uuid null, "applied_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(
      `create unique index "user_memory_task_results_task_operation_unique" on "user_memory_task_results" ("task_id", "operation_key");`,
    );
    this.addSql(
      `alter table "user_memory_task_results" add constraint "user_memory_task_results_action_check" check ("action" in ('upsert', 'delete'));`,
    );
    this.addSql(
      `alter table "user_memory_task_results" add constraint "user_memory_task_results_task_id_foreign" foreign key ("task_id") references "user_memory_tasks" ("id") on update cascade on delete cascade;`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql('drop table if exists "user_memory_task_results" cascade;');
    this.addSql('drop table if exists "user_memory_tasks" cascade;');
    this.addSql('drop table if exists "user_memories" cascade;');
    this.addSql('drop table if exists "user_memory_settings" cascade;');
  }
}
