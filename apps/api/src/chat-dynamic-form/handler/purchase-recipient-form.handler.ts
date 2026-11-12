import {
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';

import type {
  DynamicFormContext,
  DynamicFormHandler,
  DynamicFormPurchasePort,
  DynamicFormSubmissionResult,
  DynamicFormValidationResult,
} from '../port/dynamic-form-handler.port.js';
import { DYNAMIC_FORM_PURCHASE_PORT } from '../port/dynamic-form-handler.port.js';
import type { DynamicFormDefinition } from '../dto/chat-dynamic-form-response.js';
import type { DynamicFormRequestInput } from '../dto/chat-dynamic-form.schema.js';

@Injectable()
export class PurchaseRecipientFormHandler implements DynamicFormHandler {
  public readonly formKind = 'purchase_recipient' as const;

  public constructor(
    @Optional()
    @Inject(DYNAMIC_FORM_PURCHASE_PORT)
    private readonly purchase: DynamicFormPurchasePort | undefined,
  ) {}

  private port(): DynamicFormPurchasePort {
    if (!this.purchase) {
      throw new ServiceUnavailableException('购买表单处理器尚未配置');
    }
    return this.purchase;
  }

  public prepare(context: DynamicFormContext, input: DynamicFormRequestInput) {
    return this.port().prepareForm(context, input);
  }

  public validate(
    context: DynamicFormContext,
    definition: DynamicFormDefinition,
    values: Record<string, string | number | boolean>,
  ): Promise<DynamicFormValidationResult> {
    return this.port().validateForm(context, definition, values);
  }

  public submit(
    context: DynamicFormContext,
    definition: DynamicFormDefinition,
    values: Record<string, string | number | boolean>,
  ): Promise<DynamicFormSubmissionResult> {
    return this.port().submitForm(context, definition, values);
  }
}
