import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadEnvironment } from '../environment.js';

test('Nest、ORM 与 Seed 环境优先级为进程 > .env.dev > .env', () => {
  const directory = mkdtempSync(join(tmpdir(), 'guide-environment-'));
  try {
    writeFileSync(join(directory, '.env'), 'A=base\nB=base\nC=base\n');
    writeFileSync(join(directory, '.env.dev'), 'A=dev\nB=dev\n');
    const environment: NodeJS.ProcessEnv = { A: 'process' };
    loadEnvironment(environment, directory);
    assert.deepEqual(environment, { A: 'process', B: 'dev', C: 'base' });
    loadEnvironment(environment, directory);
    assert.deepEqual(environment, { A: 'process', B: 'dev', C: 'base' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
