import 'dotenv/config';

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
