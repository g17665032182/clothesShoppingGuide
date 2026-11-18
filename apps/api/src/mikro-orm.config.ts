/*
 * @Date: 2026-10-26 22:33:47
 * @LastEditors: shiyu 625991037@qq.com
 * @LastEditTime: 2026-11-17 20:58:29
 * @FilePath: /clothesShoppingGuide/apps/api/src/mikro-orm.config.ts
 * @Description:
 */
import './common/config/environment.js';

import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { SeedManager } from '@mikro-orm/seeder';

export default defineConfig({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? 'clothes',
  password: process.env.DB_PASSWORD ?? 'clothes',
  dbName: process.env.DB_NAME ?? 'clothes_guide',
  entities: ['./dist/**/*.entity.js'],
  entitiesTs: ['./src/**/*.entity.ts'],
  extensions: [Migrator, SeedManager],
  debug: process.env.DB_DEBUG === 'true',
  driverOptions: {
    // 后台任务与上下文读取共用连接池，连接建立和 SQL 均使用有界等待。
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    query_timeout: 20_000,
    ssl: {
      rejectUnauthorized: false,
    },
  },
  discovery: {
    // 基础项目尚未包含业务 Entity，避免启动时把空实体目录视为错误。
    warnWhenNoEntities: false,
  },
  migrations: {
    path: './dist/database/migrations',
    pathTs: './src/database/migrations',
    glob: '!(*.d).{js,ts}',
    emit: 'ts',
    dropTables: false,
  },
  seeder: {
    path: './dist/database/seeders',
    pathTs: './src/database/seeders',
    defaultSeeder: 'DatabaseSeeder',
    glob: '!(*.d).{js,ts}',
    emit: 'ts',
  },
});
