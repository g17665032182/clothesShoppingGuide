import type {
  DynamicFormDefinition,
  DynamicFormField,
  DynamicFormResultReference,
} from '../dto/chat-dynamic-form-response.js';
import type { DynamicFormRequestInput } from '../dto/chat-dynamic-form.schema.js';

export const DYNAMIC_FORM_HANDLERS = Symbol('DYNAMIC_FORM_HANDLERS');
export const DYNAMIC_FORM_PURCHASE_PORT = Symbol('DYNAMIC_FORM_PURCHASE_PORT');

export type DynamicFormContext = {
  userId: string;
  conversationId: string;
  runId?: string;
  handlerContext?: Record<string, string | number>;
};

export type DynamicFormFieldIssue = {
  key: string;
  code: string;
  message: string;
};

export type DynamicFormValidationResult =
  | { ok: true; values: Record<string, string | number | boolean> }
  | { ok: false; issues: DynamicFormFieldIssue[] };

export type DynamicFormSubmissionResult = DynamicFormResultReference;

export interface DynamicFormHandler {
  readonly formKind: string;
  prepare(
    context: DynamicFormContext,
    input: DynamicFormRequestInput,
  ): Promise<{
    title: string;
    description: string | null;
    fields: DynamicFormField[];
    submitLabel: string;
    handlerContext?: Record<string, string | number>;
  }>;
  validate(
    context: DynamicFormContext,
    definition: DynamicFormDefinition,
    values: Record<string, string | number | boolean>,
  ): Promise<DynamicFormValidationResult>;
  submit(
    context: DynamicFormContext,
    definition: DynamicFormDefinition,
    values: Record<string, string | number | boolean>,
  ): Promise<DynamicFormSubmissionResult>;
}

export interface DynamicFormPurchasePort {
  prepareForm(
    context: DynamicFormContext,
    input: DynamicFormRequestInput,
  ): Promise<{
    title: string;
    description: string | null;
    fields: DynamicFormField[];
    submitLabel: string;
    /** 仅服务端保存，不能进入表单定义或模型上下文。 */
    handlerContext?: Record<string, string | number>;
  }>;
  validateForm(
    context: DynamicFormContext,
    definition: DynamicFormDefinition,
    values: Record<string, string | number | boolean>,
  ): Promise<DynamicFormValidationResult>;
  submitForm(
    context: DynamicFormContext,
    definition: DynamicFormDefinition,
    values: Record<string, string | number | boolean>,
  ): Promise<DynamicFormSubmissionResult>;
}
