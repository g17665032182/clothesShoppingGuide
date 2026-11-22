import { MikroORM } from '@mikro-orm/postgresql';

import config from './mikro-orm.production.config.js';
import { DatabaseSeeder } from './dist/database/seeders/DatabaseSeeder.js';
import { ProductCatalogTestSeeder } from './dist/database/seeders/ProductCatalogTestSeeder.js';

const orm = await MikroORM.init(config);

try {
  // 数据库初始化失败时入口脚本会退出，API 不会带着未升级的结构启动。
  await orm.migrator.up();
  await orm.seeder.seed(DatabaseSeeder);

  if (process.env.RUN_TEST_CATALOG_SEEDER === 'true') {
    await orm.seeder.seed(ProductCatalogTestSeeder);
  }
} finally {
  await orm.close(true);
}
