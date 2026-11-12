import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';

import type { DynamicFormRequestInput } from '../dto/chat-dynamic-form.schema.js';
import type { DynamicFormDefinition } from '../dto/chat-dynamic-form-response.js';
import {
  DYNAMIC_FORM_HANDLERS,
  type DynamicFormContext,
  type DynamicFormHandler,
} from '../port/dynamic-form-handler.port.js';

const allowedKeys: Record<string, Set<string>> = {
  purchase_recipient: new Set([
    'skuId',
    'quantity',
    'recipient.name',
    'recipient.phone',
    'recipient.address',
  ]),
};

@Injectable()
export class DynamicFormRegistryService {
  private readonly handlers: Map<string, DynamicFormHandler>;

  public constructor(
    @Optional()
    @Inject(DYNAMIC_FORM_HANDLERS)
    handlers: DynamicFormHandler[] | undefined,
  ) {
    this.handlers = new Map(
      (handlers ?? []).map((handler) => [handler.formKind, handler]),
    );
  }

  public get(formKind: string): DynamicFormHandler {
    const handler = this.handlers.get(formKind);
    if (!handler) throw new BadRequestException('不支持的动态表单类型');
    return handler;
  }

  public assertDefinition(definition: DynamicFormDefinition): void {
    const allowed = allowedKeys[definition.formKind];
    if (!allowed) throw new BadRequestException('不支持的动态表单类型');
    const keys = new Set<string>();
    for (const field of definition.fields) {
      if (!allowed.has(field.key) || keys.has(field.key)) {
        throw new BadRequestException('表单字段不符合业务白名单');
      }
      keys.add(field.key);
      if (field.type === 'select' && !field.options?.length) {
        throw new BadRequestException('选择字段缺少选项');
      }
      if (field.type !== 'select' && field.options !== null) {
        throw new BadRequestException('非选择字段不能携带选项');
      }
    }
  }

  public async prepare(
    context: DynamicFormContext,
    input: DynamicFormRequestInput,
  ) {
    const handler = this.get(input.formKind);
    const prepared = await handler.prepare(context, input);
    const definition = {
      ...prepared,
      fields: prepared.fields.map((field) => ({
        ...field,
        placeholder: field.placeholder ?? null,
      })),
    };
    this.assertDefinition({
      formId: '00000000-0000-4000-8000-000000000000',
      formKind: input.formKind,
      revision: 1,
      ...definition,
      status: 'open',
      expiresAt: new Date().toISOString(),
    });
    return definition;
  }

  public handler(formKind: string) {
    return this.get(formKind);
  }
}
