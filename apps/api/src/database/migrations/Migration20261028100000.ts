import { Migration } from '@mikro-orm/migrations';

export class Migration20261028100000 extends Migration {
  override name = 'Migration20261028100000';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "refresh_sessions" ("id" uuid not null, "user_id" uuid not null, "token_hash" varchar(64) not null, "expires_at" timestamptz not null, "created_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(
      `create unique index "refresh_sessions_token_hash_unique" on "refresh_sessions" ("token_hash");`,
    );
    this.addSql(
      `create index "refresh_sessions_user_id_index" on "refresh_sessions" ("user_id");`,
    );
    this.addSql(
      `alter table "refresh_sessions" add constraint "refresh_sessions_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql('drop table if exists "refresh_sessions" cascade;');
  }
}
