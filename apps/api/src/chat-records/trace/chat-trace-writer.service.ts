import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import type { EntityManager } from '@mikro-orm/core';
import { type EntityRepository } from '@mikro-orm/postgresql';

import type {
  LlmTraceEvent,
  LlmTraceWriteContext,
} from '../../llm/trace/llm-trace.types.js';
import {
  chatCardSchema,
  chatCardSelectionSchema,
} from '../display/chat-display.projection.js';

import {
  ChatTraceEvent,
  ChatTraceEventStatus,
  ChatTraceEventType,
} from '../entity/chat-trace-event.entity.js';

const MAX_PAYLOAD_BYTES = 32_768;
const PURCHASE_TOOL_NAMES = new Set([
  'get_purchase_draft',
  'update_purchase_draft',
  'discard_purchase_draft',
]);
const DYNAMIC_FORM_TOOL_NAME = 'request_dynamic_form';
const ADDRESS_TOOL_NAMES = new Set([
  'list_my_orders',
  'list_my_shipping_addresses',
  'select_my_shipping_address',
]);
const USER_INFORMATION_TOOL_NAME = 'get_my_information';
const INFORMATION_SECTIONS = new Set([
  'addresses',
  'orders',
  'photos',
  'try_on_tasks',
]);
const TRY_ON_TASK_STATUSES = new Set([
  'queued',
  'processing',
  'succeeded',
  'failed',
]);
const PURCHASE_STATUSES = new Set([
  'collecting',
  'ready',
  'submitted',
  'cancelled',
  'expired',
]);
const PURCHASE_ISSUES = new Set([
  'missing_field',
  'sku_selection_required',
  'product_unavailable',
  'sku_unavailable',
  'insufficient_stock',
  'price_changed',
  'specification_changed',
  'expired',
  'version_conflict',
  'not_found',
  'unavailable',
]);
const PURCHASE_FIELDS = new Set([
  'skuId',
  'quantity',
  'recipient',
  'name',
  'phone',
  'address',
  'recipient.name',
  'recipient.phone',
  'recipient.address',
]);
const CREDENTIAL_KEY_PATTERN =
  /password|secret|token|api[_-]?key|authorization|credential/i;
const REDACTED_VALUE = '[REDACTED]';

type NormalizedEvent = {
  sequence: number;
  eventType: ChatTraceEventType;
  messageId: string | null;
  toolCallId: string | null;
  toolName: string | null;
  content: string | null;
  payload: Record<string, unknown> | unknown[] | null;
  status: ChatTraceEventStatus | null;
  model: string | null;
  usage: Record<string, unknown> | null;
};

const TRACE_EVENT_TYPES: Record<LlmTraceEvent['type'], ChatTraceEventType> = {
  input: ChatTraceEventType.INPUT,
  model_response: ChatTraceEventType.MODEL_RESPONSE,
  tool_call: ChatTraceEventType.TOOL_CALL,
  tool_result: ChatTraceEventType.TOOL_RESULT,
};

function redactValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new Error('循环引用不可保存');
    }
    seen.add(value);
    const result = value.map((item) => redactValue(item, seen));
    seen.delete(value);
    return result;
  }

  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) {
      throw new Error('循环引用不可保存');
    }
    seen.add(value);
    const result = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        CREDENTIAL_KEY_PATTERN.test(key)
          ? REDACTED_VALUE
          : redactValue(item, seen),
      ]),
    );
    seen.delete(value);
    return result;
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }

  throw new Error('事件包含不可序列化的数据');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizePayload(value: unknown): Record<string, unknown> | unknown[] {
  const sanitized = redactValue(value);
  const normalized =
    !Array.isArray(sanitized) && typeof sanitized !== 'object'
      ? { value: sanitized }
      : sanitized === null
        ? { value: null }
        : sanitized;
  const serialized = JSON.stringify(normalized);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new Error('事件 payload 超出保存上限');
  }
  return normalized as Record<string, unknown> | unknown[];
}

function normalizeContent(content: string): string {
  if (Buffer.byteLength(content, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new Error('事件内容超出保存上限');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return content;
  }
  const sanitized = redactValue(parsed);
  const normalized = JSON.stringify(sanitized);
  if (Buffer.byteLength(normalized, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new Error('事件 payload 超出保存上限');
  }
  return normalized;
}

function isPurchaseTool(name: string | null | undefined): boolean {
  return Boolean(name && PURCHASE_TOOL_NAMES.has(name));
}

function isDynamicFormTool(name: string | null | undefined): boolean {
  return name === DYNAMIC_FORM_TOOL_NAME;
}

function isUserInformationTool(name: string | null | undefined): boolean {
  return name === USER_INFORMATION_TOOL_NAME;
}

function safeInformationArguments(value: unknown): Record<string, unknown> {
  const source = parseToolValue(value);
  if (typeof source !== 'object' || source === null || Array.isArray(source))
    return {};
  const input = source as Record<string, unknown>;
  const sections = Array.isArray(input.sections)
    ? [
        ...new Set(
          input.sections.filter(
            (section) =>
              typeof section === 'string' && INFORMATION_SECTIONS.has(section),
          ),
        ),
      ]
    : [];
  const statusValues = new Set([
    'pending_payment',
    'pending_shipment',
    'pending_receipt',
    'completed',
    'closed',
  ]);
  return {
    sections,
    ...(typeof input.page === 'number' &&
    Number.isSafeInteger(input.page) &&
    input.page > 0 &&
    input.page <= 10
      ? { page: input.page }
      : {}),
    ...(typeof input.orderNo === 'string'
      ? { orderNo: input.orderNo.slice(0, 100) }
      : {}),
    ...(typeof input.status === 'string' && statusValues.has(input.status)
      ? { status: input.status }
      : {}),
    ...(typeof input.tryOnStatus === 'string' &&
    TRY_ON_TASK_STATUSES.has(input.tryOnStatus)
      ? { tryOnStatus: input.tryOnStatus }
      : {}),
  };
}

function safeInformationProjection(value: unknown): Record<string, unknown> {
  const source = parseToolValue(value);
  if (typeof source !== 'object' || source === null || Array.isArray(source))
    return {};
  const input = source as Record<string, unknown>;
  const sectionsSource =
    typeof input.sections === 'object' &&
    input.sections !== null &&
    !Array.isArray(input.sections)
      ? (input.sections as Record<string, unknown>)
      : {};
  const sections: Record<string, unknown> = {};
  for (const name of INFORMATION_SECTIONS) {
    const section = sectionsSource[name];
    if (
      typeof section !== 'object' ||
      section === null ||
      Array.isArray(section)
    )
      continue;
    const record = section as Record<string, unknown>;
    const items = Array.isArray(record.items) ? record.items.length : 0;
    sections[name] = {
      itemCount: items,
      ...(typeof record.total === 'number' &&
      Number.isSafeInteger(record.total) &&
      record.total >= 0
        ? { total: record.total }
        : {}),
      ...(typeof record.page === 'number' &&
      Number.isSafeInteger(record.page) &&
      record.page >= 1 &&
      record.page <= 10
        ? { page: record.page }
        : {}),
    };
  }
  const errors = Array.isArray(input.errors)
    ? input.errors.flatMap((error) => {
        if (typeof error !== 'object' || error === null || Array.isArray(error))
          return [];
        const entry = error as Record<string, unknown>;
        return typeof entry.section === 'string' &&
          INFORMATION_SECTIONS.has(entry.section) &&
          entry.code === 'unavailable'
          ? [{ section: entry.section, code: 'unavailable' }]
          : [];
      })
    : [];
  return {
    ...(typeof input.ok === 'boolean' ? { ok: input.ok } : {}),
    sections,
    errors,
  };
}

function safeInformationToolCall(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return value;
  const call = value as Record<string, unknown>;
  if (call.name !== USER_INFORMATION_TOOL_NAME) return value;
  return {
    ...(typeof call.id === 'string' ? { id: call.id.slice(0, 128) } : {}),
    name: USER_INFORMATION_TOOL_NAME,
    ...(typeof call.type === 'string' ? { type: call.type.slice(0, 32) } : {}),
    args: safeInformationArguments(call.args ?? call.arguments ?? call.input),
  };
}

function safeDynamicFormArguments(value: unknown): Record<string, unknown> {
  const source =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return null;
          }
        })()
      : value;
  if (typeof source !== 'object' || source === null || Array.isArray(source))
    return {};
  const input = source as Record<string, unknown>;
  const fields = Array.isArray(input.fields)
    ? input.fields.flatMap((field) => {
        if (typeof field !== 'object' || field === null || Array.isArray(field))
          return [];
        const entry = field as Record<string, unknown>;
        return typeof entry.key === 'string' && typeof entry.type === 'string'
          ? [{ key: entry.key.slice(0, 80), type: entry.type.slice(0, 32) }]
          : [];
      })
    : [];
  return {
    ...(typeof input.formKind === 'string'
      ? { formKind: input.formKind.slice(0, 80) }
      : {}),
    fields,
  };
}

function safeDynamicFormProjection(value: unknown): Record<string, unknown> {
  const source =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return null;
          }
        })()
      : value;
  if (typeof source !== 'object' || source === null || Array.isArray(source))
    return {};
  const input = source as Record<string, unknown>;
  const result =
    typeof input.result === 'object' &&
    input.result !== null &&
    !Array.isArray(input.result)
      ? (input.result as Record<string, unknown>)
      : input;
  return {
    ...(input.ok === true || input.ok === false ? { ok: input.ok } : {}),
    ...(typeof result.formId === 'string' ? { formId: result.formId } : {}),
    ...(typeof result.revision === 'number' &&
    Number.isSafeInteger(result.revision) &&
    result.revision > 0
      ? { revision: result.revision }
      : {}),
    ...(result.status === 'open' ? { status: 'open' } : {}),
    ...(typeof input.code === 'string' &&
    ['unavailable', 'not_found', 'version_conflict'].includes(input.code)
      ? { code: input.code }
      : {}),
  };
}

function safePurchaseProjection(value: unknown): Record<string, unknown> {
  const source =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return null;
          }
        })()
      : value;
  if (typeof source !== 'object' || source === null || Array.isArray(source))
    return {};
  const envelope = source as Record<string, unknown>;
  const record =
    typeof envelope.result === 'object' &&
    envelope.result !== null &&
    !Array.isArray(envelope.result)
      ? (envelope.result as Record<string, unknown>)
      : envelope;
  const result: Record<string, unknown> = {};
  if (
    typeof record.draftId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      record.draftId,
    )
  ) {
    result.draftId = record.draftId;
  }
  const version =
    typeof record.version === 'number'
      ? record.version
      : record.expectedVersion;
  if (
    typeof version === 'number' &&
    Number.isSafeInteger(version) &&
    version > 0
  ) {
    result.version = version;
  }
  if (typeof record.status === 'string' && PURCHASE_STATUSES.has(record.status))
    result.status = record.status;
  const changedFields = new Set<string>();
  if (Array.isArray(record.changedFields)) {
    for (const field of record.changedFields) {
      if (typeof field === 'string' && PURCHASE_FIELDS.has(field))
        changedFields.add(field);
    }
  }
  if (Object.hasOwn(record, 'skuId')) changedFields.add('skuId');
  if (Object.hasOwn(record, 'quantity')) changedFields.add('quantity');
  if (typeof record.recipient === 'object' && record.recipient !== null) {
    changedFields.add('recipient');
    for (const field of Object.keys(record.recipient)) {
      if (PURCHASE_FIELDS.has(field)) changedFields.add(field);
    }
  }
  if (changedFields.size > 0) result.changedFields = [...changedFields].sort();
  const issues = Array.isArray(record.issues)
    ? record.issues.flatMap((issue) => {
        if (typeof issue !== 'object' || issue === null || Array.isArray(issue))
          return [];
        const entry = issue as Record<string, unknown>;
        if (typeof entry.code !== 'string' || !PURCHASE_ISSUES.has(entry.code))
          return [];
        const safeIssue: Record<string, string> = { code: entry.code };
        if (typeof entry.field === 'string' && PURCHASE_FIELDS.has(entry.field))
          safeIssue.field = entry.field;
        return [safeIssue];
      })
    : [];
  if (typeof envelope.code === 'string' && PURCHASE_ISSUES.has(envelope.code)) {
    issues.push({ code: envelope.code });
  }
  if (issues.length > 0) result.issues = issues;
  return result;
}

function safePurchaseCall(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return {};
  const call = value as Record<string, unknown>;
  const id = typeof call.id === 'string' ? call.id.slice(0, 128) : null;
  const name = typeof call.name === 'string' ? call.name : null;
  if (!isPurchaseTool(name)) return redactValue(value);
  return {
    ...(id ? { id } : {}),
    name,
    ...(typeof call.type === 'string' ? { type: call.type.slice(0, 32) } : {}),
    args: safePurchaseProjection(call.args ?? call.arguments ?? call.input),
  };
}

function safeDynamicFormCall(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return {};
  const call = value as Record<string, unknown>;
  const name = typeof call.name === 'string' ? call.name : null;
  if (name !== DYNAMIC_FORM_TOOL_NAME) return redactValue(value);
  return {
    ...(typeof call.id === 'string' ? { id: call.id.slice(0, 128) } : {}),
    name,
    ...(typeof call.type === 'string' ? { type: call.type.slice(0, 32) } : {}),
    args: safeDynamicFormArguments(call.args ?? call.arguments ?? call.input),
  };
}

function sanitizeNestedPurchaseCalls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeNestedPurchaseCalls);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      ['toolCalls', 'tool_calls', 'invalid_tool_calls'].includes(key) &&
      Array.isArray(entry)
        ? entry.map(safePurchaseCall)
        : sanitizeNestedPurchaseCalls(entry),
    ]),
  );
}

function sanitizeNestedDynamicFormCalls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeNestedDynamicFormCalls);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      ['toolCalls', 'tool_calls', 'invalid_tool_calls'].includes(key) &&
      Array.isArray(entry)
        ? entry.map(safeDynamicFormCall)
        : sanitizeNestedDynamicFormCalls(entry),
    ]),
  );
}

function sanitizeNestedAddressCalls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeNestedAddressCalls);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      ['toolCalls', 'tool_calls', 'invalid_tool_calls'].includes(key) &&
      Array.isArray(entry)
        ? entry.map(safeAddressToolCall)
        : sanitizeNestedAddressCalls(entry),
    ]),
  );
}

function sanitizeNestedInformationCalls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeNestedInformationCalls);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      ['toolCalls', 'tool_calls', 'invalid_tool_calls'].includes(key) &&
      Array.isArray(entry)
        ? entry.map(safeInformationToolCall)
        : sanitizeNestedInformationCalls(entry),
    ]),
  );
}

function safePurchaseResult(content: string): string {
  return JSON.stringify(safePurchaseProjection(content));
}

function parseToolValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function safeAddressToolProjection(
  toolName: string | null | undefined,
  value: unknown,
): Record<string, unknown> {
  const source = parseToolValue(value);
  if (typeof source !== 'object' || source === null || Array.isArray(source))
    return {};
  const record = source as Record<string, unknown>;
  if (toolName === 'list_my_orders') {
    const orders = Array.isArray(record.orders)
      ? record.orders.flatMap((order) => {
          if (
            typeof order !== 'object' ||
            order === null ||
            Array.isArray(order)
          )
            return [];
          const entry = order as Record<string, unknown>;
          const result: Record<string, unknown> = {};
          for (const key of [
            'id',
            'orderNo',
            'status',
            'closeReason',
            'itemsAmount',
            'payableAmount',
            'itemCount',
            'createdAt',
            'paidAt',
            'shippedAt',
            'completedAt',
            'expiresAt',
          ]) {
            const item = entry[key];
            if (typeof item === 'string' || typeof item === 'number')
              result[key] = item;
            else if (item === null) result[key] = null;
          }
          result.items = Array.isArray(entry.items)
            ? entry.items.flatMap((item) => {
                if (
                  typeof item !== 'object' ||
                  item === null ||
                  Array.isArray(item)
                )
                  return [];
                const product = item as Record<string, unknown>;
                return [
                  Object.fromEntries(
                    ['productName', 'color', 'size', 'quantity']
                      .filter((key) => Object.hasOwn(product, key))
                      .map((key) => [key, product[key]]),
                  ),
                ];
              })
            : [];
          return [result];
        })
      : [];
    return {
      ...(typeof record.ok === 'boolean' ? { ok: record.ok } : {}),
      orders,
    };
  }
  if (toolName === 'list_my_shipping_addresses') {
    const items = Array.isArray(record.items)
      ? record.items.flatMap((item) => {
          if (typeof item !== 'object' || item === null || Array.isArray(item))
            return [];
          const entry = item as Record<string, unknown>;
          if (
            typeof entry.addressId !== 'string' ||
            typeof entry.isDefault !== 'boolean' ||
            typeof entry.displayName !== 'string'
          )
            return [];
          return [
            {
              addressId: entry.addressId,
              isDefault: entry.isDefault,
              displayName: entry.displayName,
            },
          ];
        })
      : [];
    return {
      items,
      ...(Number.isSafeInteger(record.total) ? { total: record.total } : {}),
      ...(Number.isSafeInteger(record.page) ? { page: record.page } : {}),
      ...(Number.isSafeInteger(record.pageSize)
        ? { pageSize: record.pageSize }
        : {}),
    };
  }
  const result =
    typeof record.result === 'object' &&
    record.result !== null &&
    !Array.isArray(record.result)
      ? (record.result as Record<string, unknown>)
      : {};
  const filled =
    typeof result.filled === 'object' &&
    result.filled !== null &&
    !Array.isArray(result.filled)
      ? (result.filled as Record<string, unknown>)
      : {};
  return {
    ...(typeof record.ok === 'boolean' ? { ok: record.ok } : {}),
    ...(typeof record.code === 'string' &&
    ['version_conflict', 'not_found', 'unavailable'].includes(record.code)
      ? { code: record.code }
      : {}),
    ...(typeof result.draftId === 'string'
      ? { result: { draftId: result.draftId } }
      : {}),
    ...(Number.isSafeInteger(result.version)
      ? { version: result.version }
      : {}),
    ...(Object.keys(filled).length > 0
      ? {
          filled: {
            name: filled.name === true,
            phone: filled.phone === true,
            address: filled.address === true,
          },
        }
      : {}),
  };
}

function safeAddressToolCall(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return value;
  const call = value as Record<string, unknown>;
  const name = typeof call.name === 'string' ? call.name : null;
  if (!name || !ADDRESS_TOOL_NAMES.has(name)) return value;
  return {
    ...(typeof call.id === 'string' ? { id: call.id.slice(0, 128) } : {}),
    name,
    ...(typeof call.type === 'string' ? { type: call.type.slice(0, 32) } : {}),
    args: safeAddressToolArguments(
      name,
      call.args ?? call.arguments ?? call.input,
    ),
  };
}

function safeAddressToolArguments(
  name: string,
  value: unknown,
): Record<string, unknown> {
  const args = parseToolValue(value);
  const source =
    typeof args === 'object' && args !== null && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};
  const safeArgs: Record<string, unknown> = {};
  if (name === 'list_my_orders') {
    for (const key of ['orderNo', 'status', 'page']) {
      if (Object.hasOwn(source, key)) safeArgs[key] = source[key];
    }
  } else if (name === 'list_my_shipping_addresses') {
    if (Object.hasOwn(source, 'page')) safeArgs.page = source.page;
  } else {
    for (const key of ['addressId', 'draftId', 'expectedVersion']) {
      if (Object.hasOwn(source, key)) safeArgs[key] = source[key];
    }
  }
  return safeArgs;
}

function safeChatCardArguments(value: unknown): Record<string, unknown> {
  const parsed = chatCardSelectionSchema.safeParse(parseToolValue(value));
  if (!parsed.success) return {};
  return parsed.data;
}

function safeChatCardCall(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return {};
  const call = value as Record<string, unknown>;
  const id = typeof call.id === 'string' ? call.id.slice(0, 128) : null;
  const name = typeof call.name === 'string' ? call.name : null;
  if (name !== 'display_chat_card') return redactValue(value);
  return {
    ...(id ? { id } : {}),
    name,
    ...(typeof call.type === 'string' ? { type: call.type.slice(0, 32) } : {}),
    args: safeChatCardArguments(call.args ?? call.arguments ?? call.input),
  };
}

function sanitizeNestedChatCardCalls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeNestedChatCardCalls);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      ['toolCalls', 'tool_calls', 'invalid_tool_calls'].includes(key) &&
      Array.isArray(entry)
        ? entry.map(safeChatCardCall)
        : sanitizeNestedChatCardCalls(entry),
    ]),
  );
}

function safeChatCardResult(value: unknown): string {
  const parsed = chatCardSchema.safeParse(parseToolValue(value));
  return JSON.stringify(parsed.success ? parsed.data : {});
}

function normalizeEvent(event: LlmTraceEvent): NormalizedEvent {
  if (
    event.type === 'model_response' &&
    typeof event.payload === 'object' &&
    event.payload !== null &&
    Object.hasOwn(event.payload, 'publicDisplay')
  ) {
    throw new Error('运行事件不能写入展示保留字段');
  }
  const base: NormalizedEvent = {
    sequence: event.sequence,
    eventType: TRACE_EVENT_TYPES[event.type],
    messageId: event.messageId,
    toolCallId: null,
    toolName: null,
    content: null,
    payload: null,
    status: null,
    model: null,
    usage: null,
  };

  switch (event.type) {
    case 'input':
      return { ...base, content: event.content };
    case 'model_response':
      return {
        ...base,
        content: event.content,
        payload:
          event.payload === undefined
            ? null
            : normalizePayload(
                sanitizeNestedAddressCalls(
                  sanitizeNestedInformationCalls(
                    sanitizeNestedPurchaseCalls(
                      sanitizeNestedDynamicFormCalls(
                        sanitizeNestedChatCardCalls(event.payload),
                      ),
                    ),
                  ),
                ),
              ),
        model: event.model,
        status:
          event.status === 'success'
            ? ChatTraceEventStatus.SUCCESS
            : event.status === 'failed'
              ? ChatTraceEventStatus.FAILED
              : event.status === 'partial'
                ? ChatTraceEventStatus.PARTIAL
                : null,
        usage: event.usage
          ? {
              inputTokens: event.usage.inputTokens,
              outputTokens: event.usage.outputTokens,
              totalTokens: event.usage.totalTokens,
            }
          : null,
      };
    case 'tool_call':
      return {
        ...base,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        payload: normalizePayload(
          event.toolName === 'display_chat_card'
            ? safeChatCardArguments(event.args)
            : isDynamicFormTool(event.toolName)
              ? safeDynamicFormArguments(event.args)
              : isPurchaseTool(event.toolName)
                ? safePurchaseProjection(event.args)
                : isUserInformationTool(event.toolName)
                  ? safeInformationArguments(event.args)
                  : event.toolName && ADDRESS_TOOL_NAMES.has(event.toolName)
                    ? safeAddressToolArguments(event.toolName, event.args)
                    : event.args,
        ),
      };
    case 'tool_result':
      return {
        ...base,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content:
          event.status === 'failed'
            ? '工具执行失败'
            : event.toolName === 'display_chat_card'
              ? safeChatCardResult(event.content)
              : isDynamicFormTool(event.toolName)
                ? JSON.stringify(safeDynamicFormProjection(event.content))
                : isPurchaseTool(event.toolName)
                  ? safePurchaseResult(event.content)
                  : isUserInformationTool(event.toolName)
                    ? JSON.stringify(safeInformationProjection(event.content))
                    : event.toolName && ADDRESS_TOOL_NAMES.has(event.toolName)
                      ? JSON.stringify(
                          safeAddressToolProjection(
                            event.toolName,
                            event.content,
                          ),
                        )
                      : normalizeContent(event.content),
        status:
          event.status === 'success'
            ? ChatTraceEventStatus.SUCCESS
            : ChatTraceEventStatus.FAILED,
        payload:
          event.payload === undefined
            ? null
            : normalizePayload(
                event.toolName === 'display_chat_card'
                  ? safeChatCardResult(event.payload)
                  : isDynamicFormTool(event.toolName)
                    ? safeDynamicFormProjection(event.payload)
                    : isPurchaseTool(event.toolName)
                      ? safePurchaseProjection(event.payload)
                      : isUserInformationTool(event.toolName)
                        ? safeInformationProjection(event.payload)
                        : event.toolName &&
                            ADDRESS_TOOL_NAMES.has(event.toolName)
                          ? safeAddressToolProjection(
                              event.toolName,
                              event.payload,
                            )
                          : event.payload,
              ),
      };
  }
}

function toEntity(
  context: LlmTraceWriteContext,
  event: NormalizedEvent,
): ChatTraceEvent {
  return Object.assign(new ChatTraceEvent(), {
    conversationId: context.conversationId,
    runId: context.runId,
    ...event,
  });
}

@Injectable()
export class ChatTraceWriterService {
  public constructor(
    @InjectRepository(ChatTraceEvent)
    private readonly events: EntityRepository<ChatTraceEvent>,
  ) {}

  public async writeEvents(
    context: LlmTraceWriteContext,
    events: LlmTraceEvent[],
  ): Promise<void> {
    if (events.length === 0) return;

    let normalized: NormalizedEvent[];
    try {
      normalized = events.map(normalizeEvent);
    } catch {
      throw new Error('聊天过程事件不符合安全保存要求');
    }

    const entityManager = this.events.getEntityManager();
    try {
      await entityManager.transactional(async (transaction) => {
        for (const event of normalized) {
          await this.persistIdempotently(transaction, context, event);
        }
        await transaction.flush();
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new Error('聊天过程记录保存失败');
    }
  }

  public async nextSequence(context: LlmTraceWriteContext): Promise<number> {
    const latest = await this.events.findOne(
      {
        conversationId: context.conversationId,
        runId: context.runId,
      },
      { fields: ['sequence'], orderBy: { sequence: 'DESC' } },
    );
    return (latest?.sequence ?? -1) + 1;
  }

  private async persistIdempotently(
    transaction: EntityManager,
    context: LlmTraceWriteContext,
    event: NormalizedEvent,
  ): Promise<void> {
    const identity = {
      conversationId: context.conversationId,
      runId: context.runId,
      sequence: event.sequence,
    };
    const existing = await transaction.findOne(ChatTraceEvent, identity);
    if (existing) {
      const candidate = toEntity(context, event);
      if (this.sameEvent(existing, candidate)) return;
      throw new ConflictException('聊天过程事件幂等冲突');
    }
    transaction.persist(toEntity(context, event));
  }

  private sameEvent(
    existing: ChatTraceEvent,
    candidate: ChatTraceEvent,
  ): boolean {
    return (
      existing.eventType === candidate.eventType &&
      existing.messageId === candidate.messageId &&
      existing.toolCallId === candidate.toolCallId &&
      existing.toolName === candidate.toolName &&
      existing.content === candidate.content &&
      existing.status === candidate.status &&
      existing.model === candidate.model &&
      stableStringify(this.identityPayload(existing)) ===
        stableStringify(this.identityPayload(candidate)) &&
      stableStringify(existing.usage) === stableStringify(candidate.usage)
    );
  }

  private identityPayload(event: ChatTraceEvent): ChatTraceEvent['payload'] {
    const payload = event.payload;
    if (
      event.eventType !== ChatTraceEventType.MODEL_RESPONSE ||
      payload === null ||
      Array.isArray(payload)
    ) {
      return payload;
    }
    // 绑定后无法区分原来的 null 和空对象，统一视作无原始字段；其余字段严格比较。
    const { publicDisplay: _display, ...original } = payload;
    return Object.keys(original).length === 0 ? null : original;
  }
}
