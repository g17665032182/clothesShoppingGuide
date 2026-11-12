import { apiRequest } from '@/api';
import type {
  ChatDynamicForm,
  SubmitDynamicFormPayload,
} from '@/api/types/chat-dynamic-form';

const formPath = (conversationId: string, formId: string) =>
  `/chat/conversations/${encodeURIComponent(conversationId)}/dynamic-forms/${encodeURIComponent(formId)}`;

export function getDynamicForm(
  token: string,
  conversationId: string,
  formId: string,
  signal?: AbortSignal,
): Promise<ChatDynamicForm> {
  return apiRequest<ChatDynamicForm>(formPath(conversationId, formId), {
    token,
    signal,
  });
}

export function submitDynamicForm(
  token: string,
  conversationId: string,
  formId: string,
  payload: SubmitDynamicFormPayload,
  signal?: AbortSignal,
): Promise<ChatDynamicForm> {
  return apiRequest<ChatDynamicForm>(
    `${formPath(conversationId, formId)}/submit`,
    { method: 'POST', token, signal, data: payload },
  );
}

export function cancelDynamicForm(
  token: string,
  conversationId: string,
  formId: string,
  revision: number,
  signal?: AbortSignal,
): Promise<ChatDynamicForm> {
  return apiRequest<ChatDynamicForm>(
    `${formPath(conversationId, formId)}/cancel`,
    { method: 'POST', token, signal, data: { revision } },
  );
}
