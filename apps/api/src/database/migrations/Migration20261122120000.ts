import { Migration } from '@mikro-orm/migrations';

export class Migration20261122120000 extends Migration {
  override name = 'Migration20261122120000';

  override up(): void {
    this.addSql(`create table "recommendation_groups" (
      "id" uuid primary key,
      "user_id" uuid not null,
      "conversation_id" uuid not null,
      "assistant_message_id" uuid not null,
      "intent_snapshot" jsonb not null,
      "targets" jsonb not null,
      "source_snapshot" jsonb not null,
      "created_at" timestamptz not null,
      "expires_at" timestamptz null,
      constraint "recommendation_groups_user_fk"
        foreign key ("user_id") references "users" ("id")
        on update cascade on delete cascade,
      constraint "recommendation_groups_conversation_fk"
        foreign key ("conversation_id") references "chat_conversations" ("id")
        on update cascade on delete cascade,
      constraint "recommendation_groups_assistant_message_fk"
        foreign key ("assistant_message_id") references "chat_messages" ("id")
        on update cascade on delete cascade,
      constraint "recommendation_groups_assistant_unique"
        unique ("assistant_message_id")
    );`);
    this.addSql(`create index "recommendation_groups_user_created_index"
      on "recommendation_groups" ("user_id","created_at","id");`);
    this.addSql(`create index "recommendation_groups_conversation_index"
      on "recommendation_groups" ("conversation_id","assistant_message_id");`);

    this.addSql(`create table "recommendation_settings" (
      "user_id" uuid primary key,
      "enabled" boolean not null default true,
      "updated_at" timestamptz not null,
      constraint "recommendation_settings_user_fk"
        foreign key ("user_id") references "users" ("id")
        on update cascade on delete cascade
    );`);

    this.addSql(`create table "recommendation_profiles" (
      "user_id" uuid primary key,
      "preferred_styles" jsonb not null default '[]'::jsonb,
      "avoided_styles" jsonb not null default '[]'::jsonb,
      "preferred_occasions" jsonb not null default '[]'::jsonb,
      "price_sensitivity" varchar(24) null,
      "silhouette_signals" jsonb not null default '[]'::jsonb,
      "evidence_count" integer not null default 0,
      "version" integer not null default 1,
      "generation" integer not null default 0,
      "updated_at" timestamptz not null,
      constraint "recommendation_profiles_user_fk"
        foreign key ("user_id") references "users" ("id")
        on update cascade on delete cascade,
      constraint "recommendation_profiles_counts_check"
        check ("evidence_count" >= 0 and "version" > 0 and "generation" >= 0)
    );`);

    this.addSql(`create table "recommendation_feedback_events" (
      "id" uuid primary key,
      "user_id" uuid not null,
      "recommendation_id" uuid not null,
      "conversation_id" uuid not null,
      "assistant_message_id" uuid not null,
      "target_type" varchar(16) not null,
      "target_ref" varchar(160) not null,
      "feedback_type" varchar(16) not null,
      "reason_code" varchar(40) null,
      "note" text null,
      "request_snapshot" jsonb not null,
      "target_snapshot" jsonb null,
      "idempotency_key" varchar(64) not null,
      "created_at" timestamptz not null,
      constraint "recommendation_feedback_user_fk"
        foreign key ("user_id") references "users" ("id")
        on update cascade on delete cascade,
      constraint "recommendation_feedback_group_fk"
        foreign key ("recommendation_id") references "recommendation_groups" ("id")
        on update cascade on delete cascade,
      constraint "recommendation_feedback_conversation_fk"
        foreign key ("conversation_id") references "chat_conversations" ("id")
        on update cascade on delete cascade,
      constraint "recommendation_feedback_assistant_message_fk"
        foreign key ("assistant_message_id") references "chat_messages" ("id")
        on update cascade on delete cascade,
      constraint "recommendation_feedback_type_check"
        check ("target_type" in ('recommendation','outfit','slot','item')
          and "feedback_type" in ('positive','negative','dismissed')),
      constraint "recommendation_feedback_reason_check"
        check ("reason_code" is null or "reason_code" in
          ('style','color','price','occasion','fit','too_exaggerated','too_plain')),
      constraint "recommendation_feedback_idempotency_unique"
        unique ("idempotency_key")
    );`);
    this.addSql(`create index "recommendation_feedback_user_created_index"
      on "recommendation_feedback_events" ("user_id","created_at","id");`);
    this.addSql(`create index "recommendation_feedback_group_target_index"
      on "recommendation_feedback_events"
        ("recommendation_id","target_type","target_ref");`);

    this.addSql(`create table "recommendation_profile_tasks" (
      "id" uuid primary key,
      "user_id" uuid not null,
      "generation" integer not null default 0,
      "status" varchar(16) not null default 'pending',
      "attempts" integer not null default 0,
      "available_at" timestamptz not null,
      "locked_at" timestamptz null,
      "lock_token" uuid null,
      "last_error_code" varchar(80) null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "recommendation_profile_tasks_user_fk"
        foreign key ("user_id") references "users" ("id")
        on update cascade on delete cascade,
      constraint "recommendation_profile_tasks_status_check"
        check ("status" in ('pending','processing','succeeded','failed')),
      constraint "recommendation_profile_tasks_attempts_check"
        check ("attempts" >= 0)
    );`);
    this.addSql(`create index "recommendation_profile_tasks_claim_index"
      on "recommendation_profile_tasks" ("status","available_at","created_at");`);
    this.addSql(`create index "recommendation_profile_tasks_user_index"
      on "recommendation_profile_tasks" ("user_id","created_at");`);
  }

  override down(): void {
    this.addSql('drop table "recommendation_profile_tasks";');
    this.addSql('drop table "recommendation_feedback_events";');
    this.addSql('drop table "recommendation_profiles";');
    this.addSql('drop table "recommendation_settings";');
    this.addSql('drop table "recommendation_groups";');
  }
}
