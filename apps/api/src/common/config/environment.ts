import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

export function loadEnvironment(
  target: NodeJS.ProcessEnv = process.env,
  directory = REPO_ROOT,
): void {
  // Nest、ORM CLI 和 Seed 共用优先级，避免工作目录与执行入口改变配置来源。
  config({
    path: [resolve(directory, '.env.dev'), resolve(directory, '.env')],
    processEnv: target as Record<string, string>,
    override: false,
    quiet: true,
  });
}

loadEnvironment();
