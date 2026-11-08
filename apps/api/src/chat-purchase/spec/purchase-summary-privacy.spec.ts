import assert from 'node:assert/strict';
import test from 'node:test';
import { eligibleSummaryTraceIds } from '../../chat-records/service/chat-summary-source.js';

test('摘要通过运行绑定读取真实资格，模型 ID 与可见消息 ID 不同也隔离整轮', () => {
  const source = [
    {
      runId: 'purchase',
      sequence: 0,
      messageId: 'langchain-input',
      payload: null,
    },
    {
      runId: 'purchase',
      sequence: 1,
      messageId: 'langchain-final',
      payload: { publicDisplay: { assistantMessageId: 'visible-purchase' } },
    },
    {
      runId: 'ordinary',
      sequence: 0,
      messageId: 'ordinary-input',
      payload: null,
    },
    {
      runId: 'ordinary',
      sequence: 1,
      messageId: 'ordinary-final',
      payload: { publicDisplay: { assistantMessageId: 'visible-ordinary' } },
    },
    {
      runId: 'cancelled',
      sequence: 0,
      messageId: 'cancelled-input',
      payload: null,
    },
  ];
  const allowed = eligibleSummaryTraceIds(source, [
    { id: 'visible-purchase', memoryExtractionEligible: false },
    { id: 'visible-ordinary', memoryExtractionEligible: true },
  ]);
  assert.deepEqual(
    [...allowed],
    ['ordinary:ordinary-input', 'ordinary:ordinary-final'],
  );
});

test('缺少模型消息 ID 的 trace 回退标识仍按 runId 隔离', () => {
  const allowed = eligibleSummaryTraceIds(
    [
      { runId: 'purchase', sequence: 0, messageId: null, payload: null },
      { runId: 'ordinary', sequence: 0, messageId: null, payload: null },
      {
        runId: 'purchase',
        sequence: 1,
        messageId: 'model-purchase',
        payload: { publicDisplay: { assistantMessageId: 'purchase-visible' } },
      },
      {
        runId: 'ordinary',
        sequence: 1,
        messageId: 'model-ordinary',
        payload: { publicDisplay: { assistantMessageId: 'ordinary-visible' } },
      },
    ],
    [
      { id: 'purchase-visible', memoryExtractionEligible: false },
      { id: 'ordinary-visible', memoryExtractionEligible: true },
    ],
  );
  assert.deepEqual(
    [...allowed],
    ['ordinary:trace-0', 'ordinary:model-ordinary'],
  );
});
