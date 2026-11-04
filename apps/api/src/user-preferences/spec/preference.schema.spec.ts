import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BadRequestException,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { createPreferenceSchema } from '../dto/user-preference.dto.js';
import { parsePreferenceValue } from '../context/preference-value.schema.js';

test('所有偏好类别兼容预设和自定义输入，保留默认主要偏好及文本 trim', async () => {
  const pipe = new StandardSchemaValidationPipe();
  const cases = [
    {
      category: 'size',
      value: { garment: '半身裙', label: '165/88A', system: '品牌专属码' },
    },
    {
      category: 'shoe_size',
      value: { value: 38.5, system: '自定义鞋码', width: '加宽' },
    },
    { category: 'fit', value: { preference: '微宽松', notes: '肩部留量' } },
    { category: 'style', value: { items: ['minimal', '新中式'] } },
    { category: 'occasion', value: { items: ['home', '参加婚礼'] } },
    {
      category: 'purchase_preference',
      value: { items: ['quality', '优先国货'] },
    },
    { category: 'color', value: { mode: 'prefer', items: ['黑色', '雾霾蓝'] } },
    {
      category: 'avoidance',
      value: { terms: ['紧身', '怕扎的面料'], reason: '舒适为主' },
    },
    { category: 'budget', value: { currency: 'CNY', min: 0, max: 1500 } },
  ];
  for (const body of cases) {
    assert.deepEqual(
      await pipe.transform(body, {
        type: 'body',
        schema: createPreferenceSchema,
      }),
      { ...body, isPrimary: false },
    );
  }
  assert.deepEqual(parsePreferenceValue('occasion', { items: [' 居家 '] }), {
    items: ['居家'],
  });
  assert.deepEqual(parsePreferenceValue('fit', { preference: 'loose' }), {
    preference: 'loose',
  });
});

test('预设和自定义遵守相同数量、长度及严格对象校验，Nest 返回 400', async () => {
  const pipe = new StandardSchemaValidationPipe();
  for (const [category, limit] of [
    ['style', 5],
    ['occasion', 5],
    ['purchase_preference', 6],
    ['color', 8],
  ] as const) {
    const value = {
      ...(category === 'color' ? { mode: 'prefer' } : {}),
      items: Array.from({ length: limit }, (_, index) => `自定义${index}`),
    };
    assert.doesNotThrow(() => parsePreferenceValue(category, value));
    assert.throws(() =>
      parsePreferenceValue(category, {
        ...value,
        items: [...value.items, '超限'],
      }),
    );
  }
  const invalid = [
    { category: 'occasion', value: { items: [] } },
    { category: 'occasion', value: { items: [' '] } },
    { category: 'occasion', value: { items: ['a'.repeat(33)] } },
    { category: 'occasion', value: { items: ['含\u0000控制字符'] } },
    { category: 'style', value: { items: [1] } },
    { category: 'occasion', value: { items: ['home'], unknown: true } },
    { category: 'occasion', value: { items: ['home'] }, userId: 'other' },
    { category: 'fit', value: { preference: 'a'.repeat(33) } },
    { category: 'size', value: { garment: '', label: 'L' } },
    { category: 'shoe_size', value: { value: 61, system: 'CN' } },
    { category: 'shoe_size', value: { value: '38', system: 'CN' } },
    { category: 'budget', value: { currency: 'CNY', min: 100, max: 50 } },
    { category: 'budget', value: { currency: 'CNY', max: -1 } },
    { category: 'budget', value: { currency: 'CNY', max: 100.5 } },
  ];
  for (const body of invalid) {
    await assert.rejects(
      pipe.transform(body, { type: 'body', schema: createPreferenceSchema }),
      (error: unknown) =>
        error instanceof BadRequestException && error.getStatus() === 400,
    );
  }
  assert.doesNotThrow(() =>
    parsePreferenceValue('occasion', { items: ['a'.repeat(32)] }),
  );
});
