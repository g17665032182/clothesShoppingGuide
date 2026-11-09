import { Migration } from '@mikro-orm/migrations';

export class Migration20261109184000 extends Migration {
  override name = 'Migration20261109184000';

  override up(): void {
    // 图片键可空，升级旧商品与已接受任务时不改变现有记录。
    this.addSql('alter table "products" add "try_on_image_key" text null;');
    this.addSql(
      'alter table "try_on_tasks" add "garment_image_object_key" text null;',
    );
  }

  override down(): void {
    this.addSql(
      'alter table "try_on_tasks" drop column "garment_image_object_key";',
    );
    this.addSql('alter table "products" drop column "try_on_image_key";');
  }
}
