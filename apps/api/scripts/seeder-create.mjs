import { spawnSync } from 'node:child_process';

const seederNames = process.argv.slice(2);

if (seederNames.length === 0) {
  console.error('请提供 Seeder 名称，例如：pnpm seeder:create DatabaseSeeder');
  process.exit(1);
}

// 将名称放在 CLI 命令前，避免被 --config 的数组参数误判为配置路径。
const result = spawnSync(
  'mikro-orm',
  ['seeder:create', ...seederNames, '--config', './dist/mikro-orm.config.js'],
  {
    env: {
      ...process.env,
      MIKRO_ORM_SEEDER_PATH: './src/database/seeders',
    },
    stdio: 'inherit',
  },
);

process.exit(result.status ?? 1);
