import { Migration } from '@mikro-orm/migrations';

export class Migration20261027090000 extends Migration {
  override name = 'Migration20261027090000';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "chat_conversations" ("id" uuid not null, "user_id" uuid not null, "title" varchar(200) not null, "context_summary" text null, "summary_through_message_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(
      `create index "chat_conversations_user_id_index" on "chat_conversations" ("user_id");`,
    );
    this.addSql(
      `alter table "chat_conversations" add constraint "chat_conversations_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`,
    );

    this.addSql(
      `create table "chat_messages" ("id" uuid not null, "conversation_id" uuid not null, "role" text not null, "content" text not null, "model" varchar(100) null, "input_tokens" int null, "output_tokens" int null, "total_tokens" int null, "created_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(
      `create index "chat_messages_conversation_id_index" on "chat_messages" ("conversation_id");`,
    );
    this.addSql(
      `alter table "chat_messages" add constraint "chat_messages_role_check" check ("role" in ('user', 'assistant'));`,
    );
    this.addSql(
      `alter table "chat_messages" add constraint "chat_messages_conversation_id_foreign" foreign key ("conversation_id") references "chat_conversations" ("id") on update cascade on delete cascade;`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql('drop table if exists "chat_messages" cascade;');
    this.addSql('drop table if exists "chat_conversations" cascade;');
  }
}
