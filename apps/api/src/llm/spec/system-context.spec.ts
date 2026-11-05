import assert from 'node:assert/strict';
import test from 'node:test';

import { SYSTEM_CONTEXT } from '../context/system-context.js';

test('系统上下文包含选购和退换货工作流程', () => {
  assert.match(SYSTEM_CONTEXT, /# 选购流程/);
  assert.match(SYSTEM_CONTEXT, /# 退\/换货流程/);
  assert.match(SYSTEM_CONTEXT, /已接入的本地真实商品目录/);
  assert.match(SYSTEM_CONTEXT, /商品信息只能来自本轮商品搜索工具结果/);
  assert.match(SYSTEM_CONTEXT, /订单和售后系统尚未接入/);
});
