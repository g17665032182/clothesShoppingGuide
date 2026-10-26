import { Migration } from '@mikro-orm/migrations';

export class Migration20261026182521 extends Migration {
  override name = 'Migration20261026182521';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "users" ("id" uuid not null, "email" varchar(255) not null, "password_hash" varchar(255) not null, "display_name" varchar(100) not null, "role" text not null default 'user', "status" text not null default 'active', "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`,
    );
    this.addSql(
      `alter table "users" add constraint "users_email_unique" unique ("email");`,
    );

    this.addSql(
      `alter table "users" add constraint "users_role_check" check ("role" in ('user', 'admin'));`,
    );
    this.addSql(
      `alter table "users" add constraint "users_status_check" check ("status" in ('active', 'disabled'));`,
    );
  }
}
