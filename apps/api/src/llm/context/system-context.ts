import { readFileSync } from 'node:fs';

export const SYSTEM_CONTEXT = readFileSync(
  new URL('./system-context.md', import.meta.url),
  'utf8',
).trimEnd();
