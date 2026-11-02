import { Migration } from '@mikro-orm/migrations';

export class Migration20261103130000 extends Migration {
  override name = 'Migration20261103130000';

  override up(): void {
    this.addSql(
      `create table "user_memory_document_states" ("user_id" uuid not null, "revision" int not null default 0, "object_key" varchar(512) null, "document_generation" int not null default 0, "content_hash" varchar(64) not null, "updated_at" timestamptz not null, primary key ("user_id"));`,
    );
    this.addSql(
      `alter table "user_memory_document_states" add constraint "user_memory_document_states_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "user_memory_document_states" add constraint "user_memory_document_states_nonnegative_check" check ("revision" >= 0 and "document_generation" >= 0);`,
    );
    this.addSql(
      `create index "user_memory_document_states_object_key_index" on "user_memory_document_states" ("object_key");`,
    );
    this.addSql(
      `alter table "user_memory_tasks" add column "document_generation" int not null default 0;`,
    );
    this.addSql(
      `alter table "user_memory_tasks" add constraint "user_memory_tasks_document_generation_check" check ("document_generation" >= 0);`,
    );
    this.addSql(
      `create table "user_memory_document_task_results" ("id" uuid not null, "task_id" uuid not null, "operation_key" varchar(180) not null, "applied_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(
      `alter table "user_memory_document_task_results" add constraint "user_memory_document_task_results_task_id_foreign" foreign key ("task_id") references "user_memory_tasks" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `create unique index "user_memory_document_task_results_task_operation_unique" on "user_memory_document_task_results" ("task_id", "operation_key");`,
    );
    this.addSql(
      `create table "user_memory_document_cleanups" ("id" uuid not null, "object_key" varchar(512) not null, "user_id" uuid null, "attempts" int not null default 0, "next_attempt_at" timestamptz not null, "created_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(
      `create unique index "user_memory_document_cleanups_object_key_unique" on "user_memory_document_cleanups" ("object_key");`,
    );
    this.addSql(
      `create index "user_memory_document_cleanups_due_index" on "user_memory_document_cleanups" ("next_attempt_at", "created_at");`,
    );
    this.addSql(
      `alter table "user_memory_document_cleanups" add constraint "user_memory_document_cleanups_attempts_check" check ("attempts" >= 0);`,
    );
  }

  override down(): void {
    this.addSql('drop table if exists "user_memory_document_cleanups";');
    this.addSql('drop table if exists "user_memory_document_task_results";');
    this.addSql(
      'alter table "user_memory_tasks" drop constraint "user_memory_tasks_document_generation_check";',
    );
    this.addSql(
      'alter table "user_memory_tasks" drop column "document_generation";',
    );
    this.addSql('drop table if exists "user_memory_document_states";');
  }
}
