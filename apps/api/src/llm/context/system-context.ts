/*
 * @Date: 2026-11-02 17:31:27
 * @LastEditors: shiyu 625991037@qq.com
 * @LastEditTime: 2026-11-02 22:06:20
 * @FilePath: /clothesShoppingGuide/apps/api/src/llm/context/system-context.ts
 * @Description:
 */
import { readFileSync } from 'node:fs';

function readContextFile(fileName: string): string {
  return readFileSync(new URL(`./${fileName}`, import.meta.url), 'utf8').trim();
}

export const SYSTEM_CONTEXT = [
  readContextFile('system-context.md'),
  readContextFile('shopping-flow.md'),
  readContextFile('after-sales-flow.md'),
].join('\n\n');
