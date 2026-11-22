import { Migration } from '@mikro-orm/migrations';

export class Migration20261113100000 extends Migration {
  override name = 'Migration20261113100000';

  override up(): void {
    // 动态表单只保存服务端定义、状态和非敏感结果引用，不保存用户填写值。
    this.addSql(`create table "chat_dynamic_forms" (
      "id" uuid primary key,
      "user_id" uuid not null,
      "conversation_id" uuid not null,
      "run_id" uuid not null,
      "assistant_message_id" uuid null,
      "form_kind" varchar(80) not null,
      "revision" integer not null default 1,
      "definition" jsonb not null,
      "handler_context" jsonb not null,
      "status" varchar(20) not null default 'open',
      "result_reference" jsonb null,
      "submission_fingerprint" varchar(64) null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "expires_at" timestamptz not null,
      constraint "chat_dynamic_forms_user_fk" foreign key ("user_id")
        references "users" ("id") on update cascade on delete cascade,
      constraint "chat_dynamic_forms_conversation_fk" foreign key ("conversation_id")
        references "chat_conversations" ("id") on update cascade on delete cascade,
      constraint "chat_dynamic_forms_status_check" check (
        "status" in ('open','submitted','expired','cancelled')
      ),
      constraint "chat_dynamic_forms_revision_check" check ("revision" > 0)
    );`);
    this.addSql(`create index "chat_dynamic_forms_user_conversation_created_index"
      on "chat_dynamic_forms" ("user_id","conversation_id","created_at","id");`);
    this.addSql(`create index "chat_dynamic_forms_conversation_message_index"
      on "chat_dynamic_forms" ("conversation_id","assistant_message_id");`);
  }

  override down(): void {
    this.addSql('drop table "chat_dynamic_forms";');
  }
}
