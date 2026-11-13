import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRequestDynamicFormTool,
  type DynamicFormDefinition,
} from '../tools/request-dynamic-form.tool.js';

const input = {
  formKind: 'purchase_recipient' as const,
  fields: [
    {
      key: 'recipient.address',
      label: '收货地址',
      type: 'textarea' as const,
      required: true,
    },
  ],
  title: '补充收货信息',
};

const definition = {
  formId: '11111111-1111-4111-8111-111111111111',
  formKind: 'purchase_recipient',
  revision: 1,
  title: '补充收货信息',
  description: null,
  fields: [],
  submitLabel: '确认提交',
  status: 'open',
  expiresAt: '2026-11-14T00:00:00.000Z',
} as DynamicFormDefinition;

test('动态表单 preflight 可在创建和发送前拦截并只返回安全状态', async () => {
  let requested = false;
  let emitted = false;
  const requestTool = createRequestDynamicFormTool(
    async () => {
      requested = true;
      return {
        definition,
        safeResult: {
          formId: definition.formId,
          revision: 1,
          status: 'open',
        },
      };
    },
    () => {
      emitted = true;
    },
    async () => ({ ok: false, code: 'address_selection_required' }),
  );

  assert.equal(
    String(await requestTool.invoke(input)),
    '{"ok":false,"code":"address_selection_required"}',
  );
  assert.equal(requested, false);
  assert.equal(emitted, false);
});

test('动态表单 preflight 放行时才创建并发送表单定义', async () => {
  let emittedDefinition: DynamicFormDefinition | undefined;
  const requestTool = createRequestDynamicFormTool(
    async () => ({
      definition,
      safeResult: {
        formId: definition.formId,
        revision: 1,
        status: 'open',
      },
    }),
    (value) => {
      emittedDefinition = value;
    },
    async () => null,
  );

  assert.equal(
    String(await requestTool.invoke(input)),
    `{"ok":true,"formId":"${definition.formId}","revision":1,"status":"open"}`,
  );
  assert.equal(emittedDefinition, definition);
});
