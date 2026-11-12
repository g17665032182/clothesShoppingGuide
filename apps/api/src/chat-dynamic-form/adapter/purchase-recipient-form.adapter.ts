import { Injectable } from '@nestjs/common';

import { PurchaseDraftService } from '../../chat-purchase/index.js';
import type {
  DynamicFormContext,
  DynamicFormFieldIssue,
  DynamicFormPurchasePort,
  DynamicFormSubmissionResult,
  DynamicFormValidationResult,
} from '../port/dynamic-form-handler.port.js';
import type {
  DynamicFormDefinition,
  DynamicFormField,
} from '../dto/chat-dynamic-form-response.js';
import type { DynamicFormRequestInput } from '../dto/chat-dynamic-form.schema.js';
import { patchPurchaseSchema } from '../../chat-purchase/dto/chat-purchase.schema.js';

const purchaseFieldKeys = new Set([
  'skuId',
  'quantity',
  'recipient.name',
  'recipient.phone',
  'recipient.address',
]);

function fieldFor(
  key: string,
  requested: DynamicFormRequestInput['fields'][number],
  state: Awaited<ReturnType<PurchaseDraftService['dynamicFormState']>>,
): DynamicFormField | null {
  switch (key) {
    case 'skuId':
      return {
        key,
        label: requested.label,
        type: 'select',
        required: true,
        placeholder: null,
        options: state.skus
          .filter((sku) => sku.inStock)
          .map((sku) => ({
            value: sku.skuId,
            label: `${sku.color} / ${sku.size}`,
          })),
        value: state.draft.skuId,
      };
    case 'quantity':
      return {
        key,
        label: requested.label,
        type: 'number',
        required: true,
        placeholder: null,
        options: null,
        value: state.draft.quantity,
      };
    case 'recipient.name':
      return {
        key,
        label: requested.label,
        type: 'text',
        required: true,
        placeholder: requested.placeholder ?? null,
        options: null,
        value: null,
      };
    case 'recipient.phone':
      return {
        key,
        label: requested.label,
        type: 'tel',
        required: true,
        placeholder: requested.placeholder ?? null,
        options: null,
        value: null,
      };
    case 'recipient.address':
      return {
        key,
        label: requested.label,
        type: 'textarea',
        required: true,
        placeholder: requested.placeholder ?? null,
        options: null,
        value: null,
      };
    default:
      return null;
  }
}

function toPatch(
  context: DynamicFormContext,
  values: Record<string, string | number | boolean>,
) {
  const draftId = context.handlerContext?.draftId;
  const expectedVersion = context.handlerContext?.draftVersion;
  if (typeof draftId !== 'string' || typeof expectedVersion !== 'number')
    return null;
  const input: Record<string, unknown> = { expectedVersion };
  if (typeof values.skuId === 'string') input.skuId = values.skuId;
  if (typeof values.quantity === 'number') input.quantity = values.quantity;
  const recipient: Record<string, string> = {};
  for (const [key, target] of [
    ['recipient.name', 'name'],
    ['recipient.phone', 'phone'],
    ['recipient.address', 'address'],
  ] as const) {
    const value = values[key];
    if (typeof value === 'string' && value.trim()) recipient[target] = value;
  }
  if (Object.keys(recipient).length) input.recipient = recipient;
  return { draftId, input };
}

function makeIssue(
  key: string,
  code: string,
  message: string,
): DynamicFormFieldIssue {
  return { key, code, message };
}

@Injectable()
export class PurchaseRecipientFormAdapter implements DynamicFormPurchasePort {
  public constructor(private readonly drafts: PurchaseDraftService) {}

  public async prepareForm(
    context: DynamicFormContext,
    input: DynamicFormRequestInput,
  ) {
    const state = await this.drafts.dynamicFormState(
      context.userId,
      context.conversationId,
    );
    const fields = input.fields.flatMap((requested) => {
      if (!purchaseFieldKeys.has(requested.key)) return [];
      const field = fieldFor(requested.key, requested, state);
      return field ? [field] : [];
    });
    if (!fields.length) throw new Error('没有可收集的购买字段');
    return {
      title: input.title,
      description: input.description ?? null,
      fields,
      submitLabel: input.submitLabel ?? '确认提交',
      handlerContext: {
        draftId: state.draft.id,
        draftVersion: state.draft.version,
      },
    };
  }

  public async validateForm(
    context: DynamicFormContext,
    definition: DynamicFormDefinition,
    values: Record<string, string | number | boolean>,
  ): Promise<DynamicFormValidationResult> {
    const allowed = new Set(definition.fields.map((field) => field.key));
    const issues: DynamicFormFieldIssue[] = [];
    for (const field of definition.fields) {
      const value = values[field.key];
      if (
        field.required &&
        (value === undefined || (typeof value === 'string' && !value.trim()))
      ) {
        issues.push(makeIssue(field.key, 'required', `${field.label}不能为空`));
      }
    }
    for (const key of Object.keys(values)) {
      if (!allowed.has(key))
        issues.push(makeIssue(key, 'unknown_field', '字段不受支持'));
    }
    if (issues.length) return { ok: false, issues };
    const patch = toPatch(context, values);
    if (!patch) {
      return {
        ok: false,
        issues: [
          makeIssue(
            '',
            'context_unavailable',
            '购买草稿状态已失效，请重新打开表单',
          ),
        ],
      };
    }
    const parsed = patchPurchaseSchema.safeParse(patch.input);
    if (!parsed.success) {
      return {
        ok: false,
        issues: parsed.error.issues.map((item) =>
          makeIssue(
            item.path.join('.') || 'form',
            'invalid_value',
            '字段格式不符合购买要求',
          ),
        ),
      };
    }
    return { ok: true, values };
  }

  public async submitForm(
    context: DynamicFormContext,
    _definition: DynamicFormDefinition,
    values: Record<string, string | number | boolean>,
  ): Promise<DynamicFormSubmissionResult> {
    const patch = toPatch(context, values);
    if (!patch) throw new Error('购买草稿状态已失效');
    const input = patchPurchaseSchema.parse(patch.input);
    const result = await this.drafts.patch(
      context.userId,
      context.conversationId,
      patch.draftId,
      input,
    );
    return {
      kind: 'purchase_draft_updated',
      reference: { draftId: result.id, version: result.version },
    };
  }
}
