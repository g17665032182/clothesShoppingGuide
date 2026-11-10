import { Migration } from '@mikro-orm/migrations';

export class Migration20261110120000 extends Migration {
  override name = 'Migration20261110120000';

  override up(): void {
    this.addSql(`
      create table "user_addresses" (
        "id" uuid not null,
        "user_id" uuid not null,
        "recipient_name" varchar(100) not null,
        "phone" varchar(21) not null,
        "address" varchar(500) not null,
        "label" varchar(40) null,
        "is_default" boolean not null default false,
        "create_request_key" uuid not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "user_addresses_pkey" primary key ("id"),
        constraint "user_addresses_user_id_foreign"
          foreign key ("user_id") references "users" ("id") on update cascade on delete restrict,
        constraint "user_addresses_user_request_key_unique"
          unique ("user_id", "create_request_key")
      );
    `);
    this.addSql(
      'create index "user_addresses_user_updated_index" on "user_addresses" ("user_id", "updated_at", "id");',
    );
    this.addSql(
      'create unique index "user_addresses_one_default_per_user" on "user_addresses" ("user_id") where "is_default" = true;',
    );
  }

  override down(): void {
    this.addSql('drop table if exists "user_addresses" cascade;');
  }
}
