import { Migration } from '@mikro-orm/migrations';

export class Migration20261107100000 extends Migration {
  override name = 'Migration20261107100000';

  override up(): void {
    this.addSql(`
      create table "orders" (
        "id" uuid primary key,
        "order_no" varchar(100) not null,
        "user_id" uuid not null,
        "status" varchar(32) not null,
        "close_reason" varchar(40) null,
        "currency" varchar(3) not null default 'CNY',
        "items_amount" numeric(16, 2) not null,
        "shipping_amount" numeric(16, 2) not null default 0,
        "discount_amount" numeric(16, 2) not null default 0,
        "payable_amount" numeric(16, 2) not null,
        "payment_mode" varchar(16) not null default 'simulated',
        "recipient_name" varchar(100) not null,
        "recipient_phone" varchar(21) not null,
        "recipient_address" varchar(500) not null,
        "shipment_carrier" varchar(100) null,
        "shipment_tracking_no" varchar(100) null,
        "expires_at" timestamptz not null,
        "paid_at" timestamptz null,
        "shipped_at" timestamptz null,
        "completed_at" timestamptz null,
        "closed_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "orders_order_no_unique" unique ("order_no"),
        constraint "orders_user_fk" foreign key ("user_id")
          references "users" ("id") on update cascade on delete restrict,
        constraint "orders_status_check" check (
          "status" in (
            'pending_payment', 'pending_shipment', 'pending_receipt',
            'completed', 'closed'
          )
        ),
        constraint "orders_close_state_check" check (
          ("status" = 'closed'
            and "close_reason" is not null
            and "close_reason" in (
              'user_cancelled', 'payment_expired', 'product_unavailable'
            )
            and "closed_at" is not null)
          or
          ("status" <> 'closed'
            and "close_reason" is null
            and "closed_at" is null)
        ),
        constraint "orders_payment_state_check" check (
          ("status" in ('pending_payment', 'closed') and "paid_at" is null)
          or
          ("status" in (
            'pending_shipment', 'pending_receipt', 'completed'
          ) and "paid_at" is not null)
        ),
        constraint "orders_shipment_state_check" check (
          ("status" in (
            'pending_payment', 'pending_shipment', 'closed'
          ) and "shipped_at" is null
            and "shipment_carrier" is null
            and "shipment_tracking_no" is null)
          or
          ("status" in ('pending_receipt', 'completed')
            and "shipped_at" is not null
            and "shipment_carrier" is not null
            and "shipment_tracking_no" is not null)
        ),
        constraint "orders_completed_state_check" check (
          ("status" = 'completed' and "completed_at" is not null)
          or
          ("status" <> 'completed' and "completed_at" is null)
        ),
        constraint "orders_amount_check" check (
          "currency" = 'CNY'
          and "payment_mode" = 'simulated'
          and "items_amount" >= 0
          and "shipping_amount" = 0
          and "discount_amount" = 0
          and "payable_amount" = "items_amount"
        )
      );
    `);
    this.addSql(`
      create index "orders_user_created_index"
      on "orders" ("user_id", "created_at" desc, "id" desc);
    `);
    this.addSql(`
      create index "orders_status_created_index"
      on "orders" ("status", "created_at" desc, "id" desc);
    `);
    this.addSql(`
      create index "orders_pending_expiration_index"
      on "orders" ("expires_at", "id")
      where "status" = 'pending_payment';
    `);

    this.addSql(`
      create table "order_items" (
        "id" uuid primary key,
        "order_id" uuid not null,
        "sku_id" uuid not null,
        "product_external_id" varchar(160) not null,
        "product_name" varchar(200) not null,
        "color" varchar(32) not null,
        "size" varchar(32) not null,
        "image_url" varchar(2048) null,
        "unit_price" numeric(12, 2) not null,
        "quantity" integer not null,
        "line_amount" numeric(16, 2) not null,
        constraint "order_items_order_fk" foreign key ("order_id")
          references "orders" ("id") on update cascade on delete restrict,
        constraint "order_items_sku_fk" foreign key ("sku_id")
          references "product_skus" ("id") on update cascade on delete restrict,
        constraint "order_items_order_sku_unique"
          unique ("order_id", "sku_id"),
        constraint "order_items_quantity_check"
          check ("quantity" between 1 and 99),
        constraint "order_items_amount_check"
          check ("unit_price" >= 0 and "line_amount" = "unit_price" * "quantity")
      );
    `);
    this.addSql(`
      create index "order_items_sku_order_index"
      on "order_items" ("sku_id", "order_id");
    `);

    this.addSql(`
      create table "order_idempotency" (
        "id" uuid primary key,
        "user_id" uuid not null,
        "idempotency_key" uuid not null,
        "request_hash" varchar(64) not null,
        "order_id" uuid not null,
        "created_at" timestamptz not null default now(),
        constraint "order_idempotency_user_fk" foreign key ("user_id")
          references "users" ("id") on update cascade on delete restrict,
        constraint "order_idempotency_order_fk" foreign key ("order_id")
          references "orders" ("id") on update cascade on delete restrict,
        constraint "order_idempotency_user_key_unique"
          unique ("user_id", "idempotency_key"),
        constraint "order_idempotency_order_unique" unique ("order_id"),
        constraint "order_idempotency_hash_check"
          check (length("request_hash") = 64)
      );
    `);

    this.addSql(`
      create view "active_order_sku_reservations" as
      select item."sku_id", sum(item."quantity")::bigint as "reserved_quantity"
      from "order_items" as item
      inner join "orders" as order_record on order_record."id" = item."order_id"
      where order_record."status" in ('pending_payment', 'pending_shipment')
      group by item."sku_id";
    `);
  }

  override down(): void {
    this.addSql('drop view if exists "active_order_sku_reservations";');
    this.addSql('drop table if exists "order_idempotency";');
    this.addSql('drop table if exists "order_items";');
    this.addSql('drop table if exists "orders";');
  }
}
