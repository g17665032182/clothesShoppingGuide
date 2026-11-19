import { Migration } from '@mikro-orm/migrations';

export class Migration20261119100000 extends Migration {
  override name = 'Migration20261119100000';

  override up(): void {
    this.addSql(`create table "return_refund_applications" (
      "id" uuid primary key,
      "order_id" uuid not null,
      "user_id" uuid not null,
      "order_no" varchar(100) not null,
      "status" varchar(32) not null,
      "manual_review_required" boolean not null default false,
      "manual_review_reason" varchar(64) null,
      "reason" text not null,
      "rejection_reason" varchar(1000) null,
      "refund_amount" numeric(16,2) not null,
      "currency" varchar(3) not null default 'CNY',
      "return_carrier" varchar(100) null,
      "return_tracking_no" varchar(100) null,
      "idempotency_key" uuid not null,
      "request_hash" varchar(64) not null,
      "version" integer not null default 1,
      "submitted_at" timestamptz null,
      "approved_at" timestamptz null,
      "returned_at" timestamptz null,
      "received_at" timestamptz null,
      "refund_processing_at" timestamptz null,
      "refunded_at" timestamptz null,
      "rejected_at" timestamptz null,
      "cancelled_at" timestamptz null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "return_refund_applications_user_fk"
        foreign key ("user_id") references "users" ("id") on update cascade on delete restrict,
      constraint "return_refund_applications_order_fk"
        foreign key ("order_id") references "orders" ("id") on update cascade on delete restrict,
      constraint "return_refund_applications_status_check"
        check ("status" in (
          'pending_user_submission','pending_review','approved_pending_return',
          'returned_by_user','pending_inspection','refund_processing',
          'refunded','rejected','cancelled'
        )),
      constraint "return_refund_applications_amount_check"
        check ("refund_amount" >= 0),
      constraint "return_refund_applications_version_check"
        check ("version" > 0),
      constraint "return_refund_applications_manual_review_check"
        check (
          ("manual_review_required" and "manual_review_reason" in (
            'order_not_completed','completion_time_missing','outside_return_window'
          ))
          or (not "manual_review_required" and "manual_review_reason" is null)
        ),
      constraint "return_refund_applications_rejection_check"
        check (
          ("status" = 'rejected' and "rejection_reason" is not null)
          or ("status" <> 'rejected' and "rejection_reason" is null)
        ),
      constraint "return_refund_applications_return_shipment_check"
        check (
          ("status" in ('returned_by_user','pending_inspection','refund_processing','refunded')
            and "return_carrier" is not null and "return_tracking_no" is not null)
          or ("status" not in ('returned_by_user','pending_inspection','refund_processing','refunded')
            and "return_carrier" is null and "return_tracking_no" is null)
        ),
      constraint "return_refund_applications_idempotency_unique"
        unique ("user_id", "idempotency_key)
    );`);
    this.addSql(`create index "return_refund_applications_user_created_index"
      on "return_refund_applications" ("user_id", "created_at", "id");`);
    this.addSql(`create index "return_refund_applications_status_created_index"
      on "return_refund_applications" ("status", "created_at", "id");`);
    this
      .addSql(`create unique index "return_refund_applications_one_active_order_unique"
      on "return_refund_applications" ("order_id")
      where "status" not in ('rejected','cancelled','refunded');`);

    this.addSql(`create table "return_refund_items" (
      "id" uuid primary key,
      "application_id" uuid not null,
      "order_item_id" uuid not null,
      "product_external_id" varchar(160) not null,
      "product_name" varchar(200) not null,
      "color" varchar(32) not null,
      "size" varchar(32) not null,
      "image_url" varchar(2048) null,
      "unit_price" numeric(12,2) not null,
      "quantity" integer not null,
      "line_amount" numeric(16,2) not null,
      constraint "return_refund_items_application_fk"
        foreign key ("application_id") references "return_refund_applications" ("id") on update cascade on delete restrict,
      constraint "return_refund_items_order_item_fk"
        foreign key ("order_item_id") references "order_items" ("id") on update cascade on delete restrict,
      constraint "return_refund_items_application_order_item_unique"
        unique ("application_id", "order_item_id"),
      constraint "return_refund_items_quantity_check"
        check ("quantity" between 1 and 99),
      constraint "return_refund_items_amount_check"
        check ("unit_price" >= 0 and "line_amount" >= 0)
    );`);
    this.addSql(`create index "return_refund_items_order_item_index"
      on "return_refund_items" ("order_item_id");`);

    this.addSql(`create table "return_refund_events" (
      "id" uuid primary key,
      "application_id" uuid not null,
      "action" varchar(48) not null,
      "from_status" varchar(32) null,
      "to_status" varchar(32) not null,
      "actor_user_id" uuid null,
      "actor_role" varchar(16) not null,
      "created_at" timestamptz not null,
      constraint "return_refund_events_application_fk"
        foreign key ("application_id") references "return_refund_applications" ("id") on update cascade on delete restrict,
      constraint "return_refund_events_actor_fk"
        foreign key ("actor_user_id") references "users" ("id") on update cascade on delete set null,
      constraint "return_refund_events_actor_role_check"
        check ("actor_role" in ('user','admin','system'))
    );`);
    this.addSql(`create index "return_refund_events_application_created_index"
      on "return_refund_events" ("application_id", "created_at", "id");`);

    this.addSql(`create table "return_refund_evidence" (
      "id" uuid primary key,
      "application_id" uuid not null,
      "object_key" varchar(512) not null,
      "media_type" varchar(32) not null,
      "byte_size" integer not null,
      "sha256" varchar(64) not null,
      "deleted_at" timestamptz null,
      "created_at" timestamptz not null,
      constraint "return_refund_evidence_application_fk"
        foreign key ("application_id") references "return_refund_applications" ("id") on update cascade on delete restrict,
      constraint "return_refund_evidence_object_key_unique"
        unique ("object_key"),
      constraint "return_refund_evidence_media_type_check"
        check ("media_type" in ('image/jpeg','image/png','image/webp','video/mp4')),
      constraint "return_refund_evidence_size_check"
        check (
          ("media_type" = 'video/mp4' and "byte_size" between 16 and 52428800)
          or ("media_type" <> 'video/mp4' and "byte_size" between 1 and 10485760)
        ),
      constraint "return_refund_evidence_sha256_check"
        check ("sha256" ~ '^[0-9a-f]{64}$')
    );`);
    this.addSql(`create index "return_refund_evidence_application_created_index"
      on "return_refund_evidence" ("application_id", "created_at", "id")
      where "deleted_at" is null;`);
  }

  override down(): void {
    this.addSql('drop table "return_refund_evidence";');
    this.addSql('drop table "return_refund_events";');
    this.addSql('drop table "return_refund_items";');
    this.addSql('drop table "return_refund_applications";');
  }
}
