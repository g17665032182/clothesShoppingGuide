import assert from 'node:assert/strict';
import test from 'node:test';

import { SYSTEM_CONTEXT } from '../context/system-context.js';

test('系统上下文包含选购和退换货工作流程', () => {
  assert.match(SYSTEM_CONTEXT, /# 选购流程/);
  assert.match(SYSTEM_CONTEXT, /# 退\/换货流程/);
  assert.match(SYSTEM_CONTEXT, /本地真实商品/);
  assert.match(
    SYSTEM_CONTEXT,
    /商品信息只能来自本轮商品搜索或规格查询工具结果/,
  );
  assert.match(SYSTEM_CONTEXT, /正式订单动作由用户按钮执行/);
  assert.match(SYSTEM_CONTEXT, /支付仅为模拟/);
  assert.match(SYSTEM_CONTEXT, /售后尚未接入/);
  assert.match(SYSTEM_CONTEXT, /不从旧摘要恢复收货信息/);
  assert.match(
    SYSTEM_CONTEXT,
    /查询本人地址、订单、已保存图片和试穿任务时，使用 `get_my_information` 获取安全摘要/u,
  );
  assert.match(
    SYSTEM_CONTEXT,
    /前端认证 API 完成，模型不得代选或调用地址选择工具/u,
  );
  assert.match(SYSTEM_CONTEXT, /只有用户明确选择手动填写/u);
  assert.doesNotMatch(SYSTEM_CONTEXT, /调用地址选择工具将该地址写入/u);
});

test('明细工具限定明确查询、可信商品、开关和有界分页', () => {
  assert.match(SYSTEM_CONTEXT, /`get_product_skus`/u);
  assert.match(SYSTEM_CONTEXT, /指代有歧义先询问/u);
  assert.match(SYSTEM_CONTEXT, /无匹配不等于无货/u);
  assert.match(SYSTEM_CONTEXT, /`get_my_preferences`/u);
  assert.match(SYSTEM_CONTEXT, /preferences_disabled/u);
  assert.match(SYSTEM_CONTEXT, /不用旧上下文补齐/u);
  assert.match(SYSTEM_CONTEXT, /达到第10页引导原购买或偏好管理界面/u);
});

test('试穿任务查询限定显式 section 和摘要，不承诺图片或生成时长', () => {
  assert.match(SYSTEM_CONTEXT, /sections: \["try_on_tasks"\]/u);
  assert.match(SYSTEM_CONTEXT, /省略 sections 不会查询任务/u);
  assert.match(SYSTEM_CONTEXT, /最新创建的未删除任务/u);
  assert.match(SYSTEM_CONTEXT, /查询失败不等于没有任务/u);
  assert.match(SYSTEM_CONTEXT, /不估算完成时间、不评价未读取的图片/u);
  assert.match(SYSTEM_CONTEXT, /不保证随后下载成功/u);
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
