import { Migration } from '@mikro-orm/migrations';

export class Migration20261109130000 extends Migration {
  override name = 'Migration20261109130000';

  override up(): void {
    // 只新增管理员设置；保留手写迁移维护的既有约束、索引和业务数据。
    this.addSql(
      'alter table "products" add "try_on_enabled" boolean not null default false;',
    );
  }

  override down(): void {
    this.addSql('alter table "products" drop column "try_on_enabled";');
  }
}
