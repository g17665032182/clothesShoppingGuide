import { Migration } from '@mikro-orm/migrations';

export class Migration20261109120000 extends Migration {
  override name = 'Migration20261109120000';

  override up(): void {
    this.addSql(`create table "try_on_photos" (
      "id" uuid primary key,
      "user_id" uuid not null,
      "kind" varchar(20) not null default 'temporary',
      "status" varchar(20) not null default 'active',
      "object_key" varchar(512) not null,
      "mime_type" varchar(100) not null,
      "byte_size" integer not null,
      "width" integer not null,
      "height" integer not null,
      "expires_at" timestamptz null,
      "task_id" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "try_on_photos_kind_check" check ("kind" in ('temporary','saved')),
      constraint "try_on_photos_status_check" check ("status" in ('active','deleted')),
      constraint "try_on_photos_byte_size_check" check ("byte_size" > 0),
      constraint "try_on_photos_dimensions_check" check ("width" > 0 and "height" > 0),
      constraint "try_on_photos_user_fk" foreign key ("user_id")
        references "users" ("id") on update cascade on delete cascade,
      constraint "try_on_photos_object_key_unique" unique ("object_key")
    );`);
    this.addSql(
      `create index "try_on_photos_user_kind_status_created_index"
       on "try_on_photos" ("user_id","kind","status","created_at");`,
    );
    this.addSql(
      `create index "try_on_photos_status_expires_index"
       on "try_on_photos" ("status","expires_at");`,
    );

    this.addSql(`create table "try_on_tasks" (
      "id" uuid primary key,
      "user_id" uuid not null,
      "status" varchar(20) not null default 'queued',
      "product_external_id" varchar(160) not null,
      "product_name" varchar(200) not null,
      "product_category" varchar(32) not null,
      "color" varchar(32) not null,
      "garment_image_url" text null,
      "source_photo_id" uuid null,
      "consent_version" varchar(80) not null,
      "consented_at" timestamptz not null,
      "attempts" integer not null default 0,
      "available_at" timestamptz not null,
      "locked_at" timestamptz null,
      "failure_code" varchar(80) null,
      "provider_model" varchar(120) null,
      "provider_request_id" varchar(200) null,
      "notification_read_at" timestamptz null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "completed_at" timestamptz null,
      "deleted_at" timestamptz null,
      constraint "try_on_tasks_status_check" check ("status" in ('queued','processing','succeeded','failed','deleted')),
      constraint "try_on_tasks_attempts_check" check ("attempts" between 0 and 2),
      constraint "try_on_tasks_user_fk" foreign key ("user_id")
        references "users" ("id") on update cascade on delete cascade,
      constraint "try_on_tasks_source_photo_fk" foreign key ("source_photo_id")
        references "try_on_photos" ("id") on update cascade on delete set null
    );`);
    this.addSql(
      `create index "try_on_tasks_user_created_index"
       on "try_on_tasks" ("user_id","created_at" desc,"id");`,
    );
    this.addSql(
      `create index "try_on_tasks_claim_index"
       on "try_on_tasks" ("status","available_at","created_at");`,
    );
    this.addSql(
      `create unique index "try_on_tasks_active_user_unique"
       on "try_on_tasks" ("user_id")
       where "status" in ('queued','processing');`,
    );
    this.addSql(
      `alter table "try_on_photos"
       add constraint "try_on_photos_task_fk" foreign key ("task_id")
       references "try_on_tasks" ("id") on update cascade on delete set null;`,
    );

    this.addSql(`create table "try_on_results" (
      "id" uuid primary key,
      "task_id" uuid not null,
      "user_id" uuid not null,
      "object_key" varchar(512) not null,
      "mime_type" varchar(100) not null,
      "byte_size" integer not null,
      "width" integer not null,
      "height" integer not null,
      "created_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "try_on_results_task_fk" foreign key ("task_id")
        references "try_on_tasks" ("id") on update cascade on delete cascade,
      constraint "try_on_results_user_fk" foreign key ("user_id")
        references "users" ("id") on update cascade on delete cascade,
      constraint "try_on_results_task_unique" unique ("task_id"),
      constraint "try_on_results_object_key_unique" unique ("object_key")
    );`);

    this.addSql(`create table "try_on_quotas" (
      "id" uuid primary key,
      "user_id" uuid not null,
      "quota_date" date not null,
      "success_count" integer not null default 0,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "try_on_quotas_user_fk" foreign key ("user_id")
        references "users" ("id") on update cascade on delete cascade,
      constraint "try_on_quotas_user_date_unique" unique ("user_id","quota_date"),
      constraint "try_on_quotas_success_count_check" check ("success_count" between 0 and 5)
    );`);

    this.addSql(`create table "try_on_object_cleanups" (
      "id" uuid primary key,
      "user_id" uuid null,
      "object_key" varchar(512) not null,
      "attempts" integer not null default 0,
      "next_attempt_at" timestamptz not null,
      "last_error_code" varchar(80) null,
      "created_at" timestamptz not null,
      constraint "try_on_object_cleanups_user_fk" foreign key ("user_id")
        references "users" ("id") on update cascade on delete set null,
      constraint "try_on_object_cleanups_object_key_unique" unique ("object_key")
    );`);
    this.addSql(
      `create index "try_on_object_cleanups_due_index"
       on "try_on_object_cleanups" ("next_attempt_at","created_at");`,
    );
  }

  override down(): void {
    this.addSql('drop table "try_on_object_cleanups";');
    this.addSql('drop table "try_on_quotas";');
    this.addSql('drop table "try_on_results";');
    this.addSql(
      'alter table "try_on_photos" drop constraint "try_on_photos_task_fk";',
    );
    this.addSql('drop table "try_on_tasks";');
    this.addSql('drop table "try_on_photos";');
  }
}
