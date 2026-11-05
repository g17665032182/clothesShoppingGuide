import { Migration } from '@mikro-orm/migrations';

export class Migration20261105140000 extends Migration {
  override name = 'Migration20261105140000';

  override up(): void {
    this.addSql(`
      create table products (
        id uuid primary key,
        external_id varchar(160) not null,
        name varchar(200) not null,
        brand varchar(100) null,
        category varchar(32) not null,
        description text null,
        styles jsonb not null default '[]'::jsonb,
        occasions jsonb not null default '[]'::jsonb,
        fits jsonb not null default '[]'::jsonb,
        audience varchar(16) not null default 'adult',
        product_url varchar(2048) null,
        is_active boolean not null default true,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        constraint products_external_id_unique unique (external_id),
        constraint products_category_check check (category in ('tops','bottoms','dresses','outerwear','shoes')),
        constraint products_audience_check check (audience = 'adult'),
        constraint products_tags_array_check check (
          jsonb_typeof(styles) = 'array' and
          jsonb_typeof(occasions) = 'array' and
          jsonb_typeof(fits) = 'array'
        )
      );
      create index products_active_category_index on products (is_active, category);
    `);
    this.addSql(`
      create table product_skus (
        id uuid primary key,
        product_id uuid not null references products (id) on delete restrict,
        external_sku_id varchar(160) not null,
        color varchar(32) not null,
        size varchar(32) not null,
        price numeric(12,2) not null,
        currency varchar(3) not null default 'CNY',
        stock integer not null,
        image_url varchar(2048) null,
        is_active boolean not null default true,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        constraint product_skus_product_external_id_unique unique (product_id, external_sku_id),
        constraint product_skus_price_check check (price >= 0),
        constraint product_skus_stock_check check (stock >= 0),
        constraint product_skus_currency_check check (currency = 'CNY')
      );
      create index product_skus_product_active_index on product_skus (product_id, is_active);
    `);
  }

  override down(): void {
    this.addSql('drop table product_skus;');
    this.addSql('drop table products;');
  }
}
