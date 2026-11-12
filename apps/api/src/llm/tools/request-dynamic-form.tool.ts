import { tool } from '@langchain/core/tools';
import {
  dynamicFormRequestSchema,
  type DynamicFormRequestInput as DynamicFormRequest,
} from '../../chat-dynamic-form/dto/chat-dynamic-form.schema.js';
import type {
  DynamicFormDefinition,
  DynamicFormField,
} from '../../chat-dynamic-form/dto/chat-dynamic-form-response.js';
export type { DynamicFormRequest, DynamicFormDefinition, DynamicFormField };

export type DynamicFormSafeResult = {
  formId: string;
  revision: number;
  status: 'open';
};

export type DynamicFormRequestHandler = (
  input: DynamicFormRequest,
) => Promise<{
  definition: DynamicFormDefinition;
  safeResult: DynamicFormSafeResult;
}>;

export type DynamicFormEventEmitter = (
  definition: DynamicFormDefinition,
) => void | Promise<void>;

/**
 * 该工具只负责申请 UI 表单，不接收用户填写值，也不把表单定义交给模型。
 * 完整定义通过运行时事件发送给前端，工具结果仅保留安全引用。
 */
export function createRequestDynamicFormTool(
  request: DynamicFormRequestHandler,
  emitForm: DynamicFormEventEmitter,
) {
  return tool(
    async (input) => {
      try {
        const result = await request(input);
        await emitForm(result.definition);
        return JSON.stringify({ ok: true, ...result.safeResult });
      } catch {
        // 工具结果不能暴露字段定义、业务异常或用户信息。
        return JSON.stringify({ ok: false, code: 'unavailable' });
      }
    },
    {
      name: 'request_dynamic_form',
      description:
        '当需要用户确认并填写结构化信息时请求一个受服务端约束的动态表单。不能提交用户值、用户身份、会话、URL、数据库字段或任意校验代码。',
      schema: dynamicFormRequestSchema,
    },
  );
}
