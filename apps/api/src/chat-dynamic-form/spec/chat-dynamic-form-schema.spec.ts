import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dynamicFormRequestSchema,
  dynamicFormSubmitSchema,
} from '../dto/chat-dynamic-form.schema.js';

const request = {
  formKind: 'purchase_recipient' as const,
  title: '补充购买信息',
  description: '请填写收货信息',
  submitLabel: '确认提交',
  fields: [
    {
      key: 'recipient.name',
      label: '收件人',
      type: 'text' as const,
      required: true,
      placeholder: null,
    },
    {
      key: 'recipient.phone',
      label: '手机号',
      type: 'tel' as const,
      required: true,
      placeholder: null,
    },
  ],
};

test('动态表单请求接受首版字段定义并保留安全文本', () => {
  const parsed = dynamicFormRequestSchema.parse(request);
  assert.equal(parsed.fields.length, 2);
  assert.equal(parsed.fields[0]?.key, 'recipient.name');
});

test('动态表单请求拒绝重复字段和未知字段', () => {
  assert.equal(
    dynamicFormRequestSchema.safeParse({
      ...request,
      fields: [request.fields[0], request.fields[0]],
    }).success,
    false,
  );
  assert.equal(
    dynamicFormRequestSchema.safeParse({
      ...request,
      unexpected: true,
    }).success,
    false,
  );
});

test('动态表单 select 必须提供选项且非 select 不得带选项', () => {
  assert.equal(
    dynamicFormRequestSchema.safeParse({
      ...request,
      fields: [
        {
          key: 'skuId',
          label: '规格',
          type: 'select',
          required: true,
          options: [],
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    dynamicFormRequestSchema.safeParse({
      ...request,
      fields: [
        {
          key: 'quantity',
          label: '数量',
          type: 'number',
          required: true,
          options: [{ value: '1', label: '1' }],
        },
      ],
    }).success,
    false,
  );
});

test('动态表单提交只接受原子值并拒绝嵌套对象', () => {
  assert.equal(
    dynamicFormSubmitSchema.safeParse({
      revision: 1,
      values: {
        'recipient.name': '张三',
        quantity: 2,
        confirmed: true,
      },
    }).success,
    true,
  );
  assert.equal(
    dynamicFormSubmitSchema.safeParse({
      revision: 1,
      values: { 'recipient.name': { value: '张三' } },
    }).success,
    false,
  );
});
