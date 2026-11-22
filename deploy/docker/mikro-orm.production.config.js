import config from './dist/mikro-orm.config.js';

// 生产镜像只包含编译后的 JavaScript，初始化器从 dist 加载实体、迁移和 Seeder。
export default {
  ...config,
  entitiesTs: undefined,
  migrations: {
    ...config.migrations,
    pathTs: config.migrations.path,
  },
  seeder: {
    ...config.seeder,
    pathTs: config.seeder.path,
  },
};
