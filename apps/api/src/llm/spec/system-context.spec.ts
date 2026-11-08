import assert from 'node:assert/strict';
import test from 'node:test';

import { SYSTEM_CONTEXT } from '../context/system-context.js';

test('系统上下文包含选购和退换货工作流程', () => {
  assert.match(SYSTEM_CONTEXT, /# 选购流程/);
  assert.match(SYSTEM_CONTEXT, /# 退\/换货流程/);
  assert.match(SYSTEM_CONTEXT, /本地真实商品/);
  assert.match(SYSTEM_CONTEXT, /商品信息只能来自本轮商品搜索工具结果/);
  assert.match(SYSTEM_CONTEXT, /正式订单动作由用户按钮执行/);
  assert.match(SYSTEM_CONTEXT, /支付仅为模拟/);
  assert.match(SYSTEM_CONTEXT, /售后尚未接入/);
  assert.match(SYSTEM_CONTEXT, /不从旧摘要恢复收货信息/);
});
