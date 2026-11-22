export type DynamicFormFieldType =
  | 'text'
  | 'textarea'
  | 'tel'
  | 'number'
  | 'select'
  | 'checkbox';

export type DynamicFormOption = {
  value: string;
  label: string;
};

export type DynamicFormField = {
  key: string;
  label: string;
  type: DynamicFormFieldType;
  required: boolean;
  placeholder: string | null;
  options: DynamicFormOption[] | null;
  value?: string | number | boolean | null;
};

export type ChatDynamicFormStatus =
  | 'open'
  | 'submitted'
  | 'expired'
  | 'cancelled';

export type ChatDynamicFormReference = {
  formId: string;
  formKind: string;
  revision: number;
  status: ChatDynamicFormStatus;
};

export type ChatDynamicForm = ChatDynamicFormReference & {
  title: string;
  description: string | null;
  fields: DynamicFormField[];
  submitLabel: string;
  expiresAt: string;
  result?: DynamicFormResultReference | null;
};

export type DynamicFormValue = string | number | boolean;
export type DynamicFormValues = Record<string, DynamicFormValue>;

export type ChatDynamicFormResult = {
  formId: string;
  revision: number;
  status: ChatDynamicFormStatus;
  result: {
    kind: string;
    reference: Record<string, string | number | null>;
  } | null;
  issues: Array<{
    key?: string;
    code: string;
    message: string;
  }>;
};

export type DynamicFormResultReference = ChatDynamicFormResult['result'];

export type SubmitDynamicFormPayload = {
  revision: number;
  values: DynamicFormValues;
};
