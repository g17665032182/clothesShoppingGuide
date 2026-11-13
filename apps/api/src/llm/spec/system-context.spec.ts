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
  assert.match(
    SYSTEM_CONTEXT,
    /`get_my_information` 查询本人地址、订单和已保存图片的安全摘要/u,
  );
  assert.match(
    SYSTEM_CONTEXT,
    /前端认证 API 完成，模型不得代选或调用地址选择工具/u,
  );
  assert.match(SYSTEM_CONTEXT, /只有用户明确选择手动填写/u);
  assert.doesNotMatch(SYSTEM_CONTEXT, /调用地址选择工具将该地址写入/u);
});

test('选购流程遵守本地商品目录、分页和记忆边界', () => {
  assert.match(SYSTEM_CONTEXT, /`tops`\s+\|\s+上衣/u);
  assert.match(SYSTEM_CONTEXT, /`bottoms`\s+\|\s+下装/u);
  assert.match(SYSTEM_CONTEXT, /工具首轮固定最多返回 3 件/u);
  assert.match(SYSTEM_CONTEXT, /不声称已经比较或筛选出 5 件/u);
  assert.match(SYSTEM_CONTEXT, /不得调用不存在的偏好写入工具或承诺已保存/u);
  assert.match(SYSTEM_CONTEXT, /不发送聊天消息、不调用模型/u);
  assert.match(SYSTEM_CONTEXT, /表单只询问草稿缺少的收件字段/u);
});
