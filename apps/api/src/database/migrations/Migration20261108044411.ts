import { Migration } from '@mikro-orm/migrations';

export class Migration20261108044411 extends Migration {
  override name = 'Migration20261108044411';

  override up(): void {
    // 增量迁移仅增加购买数据与来源资格，保留既有订单及幂等记录。
    this.addSql(
      `alter table "chat_messages" add "memory_extraction_eligible" boolean not null default true;`,
    );
    this.addSql(`create table "chat_purchase_drafts" (
      "id" uuid primary key, "user_id" uuid not null, "conversation_id" uuid not null,
      "product_external_id" varchar(160) not null, "sku_id" uuid null,
      "quantity" integer not null default 1,
      "recipient_name" varchar(100) null, "recipient_phone" varchar(21) null,
      "recipient_address" varchar(500) null, "status" varchar(20) not null default 'collecting',
      "version" integer not null default 1, "confirmation" jsonb null, "issues" jsonb not null,
      "submission_key" uuid not null, "submitted_version" integer null, "order_id" uuid null,
      "created_at" timestamptz not null, "updated_at" timestamptz not null, "expires_at" timestamptz not null,
      constraint "chat_purchase_drafts_submission_key_unique" unique ("submission_key"),
      constraint "chat_purchase_drafts_order_id_unique" unique ("order_id"),
      constraint "chat_purchase_drafts_conversation_fk" foreign key ("conversation_id")
        references "chat_conversations" ("id") on update cascade on delete cascade,
      constraint "chat_purchase_drafts_user_fk" foreign key ("user_id")
        references "users" ("id") on update cascade on delete cascade,
      constraint "chat_purchase_drafts_order_fk" foreign key ("order_id")
        references "orders" ("id") on update cascade on delete restrict,
      constraint "chat_purchase_drafts_status_check" check ("status" in ('collecting','ready','submitted','cancelled','expired')),
      constraint "chat_purchase_drafts_quantity_check" check ("quantity" between 1 and 99),
      constraint "chat_purchase_drafts_version_check" check ("version" > 0),
      constraint "chat_purchase_drafts_submission_check" check (
        ("status" = 'submitted' and "order_id" is not null and "submitted_version" is not null and "submitted_version" > 0)
        or ("status" <> 'submitted' and "order_id" is null and "submitted_version" is null)
      )
    );`);
    this
      .addSql(`create unique index "chat_purchase_drafts_active_conversation_unique"
      on "chat_purchase_drafts" ("conversation_id") where "status" in ('collecting','ready');`);
    this
      .addSql(`create index "chat_purchase_drafts_conversation_id_created_at_id_index"
      on "chat_purchase_drafts" ("conversation_id","created_at","id");`);
  }

  override down(): void {
    // 回滚仅清除草稿；正式订单与订单幂等始终保留。
    this.addSql('drop table "chat_purchase_drafts";');
    this.addSql(
      'alter table "chat_messages" drop column "memory_extraction_eligible";',
    );
  }
}
