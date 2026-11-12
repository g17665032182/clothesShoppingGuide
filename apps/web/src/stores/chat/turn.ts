import type {
  ChatApiMessage,
  ChatMessage,
  ChatStreamEvent,
  ChatTurnStatus,
} from '@/api/types/chat';

export function toChatMessage(message: ChatApiMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    activities: message.activities ?? [],
    sources: message.sources ?? [],
    cards: message.cards ?? [],
    productResults: message.productResults ?? [],
    orderCancellationCandidates:
      message.orderCancellationCandidates?.map((candidate) => ({
        ...candidate,
      })) ?? [],
    context: message.context ?? null,
    purchase: message.purchase ?? null,
    tryOnResult: message.tryOnResult ?? null,
    tryOnStatus: message.tryOnStatus ?? null,
    forms: [],
    status: 'saved',
  };
}

export function createPendingMessage(
  id: string,
  role: ChatMessage['role'],
  content = '',
): ChatMessage {
  return {
    id,
    role,
    content,
    createdAt: new Date().toISOString(),
    activities: [],
    sources: [],
    cards: [],
    productResults: [],
    orderCancellationCandidates: [],
    context: null,
    purchase: null,
    tryOnResult: null,
    tryOnStatus: null,
    forms: [],
    status: 'submitted',
  };
}

export function applyTurnEvent(
  message: ChatMessage,
  event: ChatStreamEvent,
  deferProductResults = false,
): void {
  if (event.type === 'delta') message.content += event.content;
  if (event.type === 'activity') {
    const index = message.activities.findIndex(
      (item) => item.id === event.activity.id,
    );
    if (index < 0) message.activities.push(event.activity);
    else message.activities[index] = event.activity;
  }
  if (event.type === 'sources') message.sources = event.sources;
  if (event.type === 'card') message.cards.push(event.card);
  if (event.type === 'purchase') message.purchase = event.purchase;
  if (event.type === 'form') {
    const index = message.forms.findIndex(
      (form) => form.formId === event.form.formId,
    );
    if (index < 0) message.forms.push(event.form);
    else message.forms[index] = event.form;
  }
  if (event.type === 'form-result') {
    const index = message.forms.findIndex(
      (form) => form.formId === event.result.formId,
    );
    if (index >= 0) {
      message.forms[index] = {
        ...message.forms[index],
        revision: event.result.revision,
        status: event.result.status,
      };
    }
  }
  if (event.type === 'try-on-status') {
    message.tryOnStatus = { ...event.status };
  }
  if (event.type === 'order-cancellation-candidates') {
    message.orderCancellationCandidates = event.orderCancellationCandidates.map(
      (candidate) => ({ ...candidate }),
    );
  }
  if (event.type === 'product-results') {
    if (!deferProductResults) message.productResults.push(event.results);
    const index = message.activities.findIndex(
      (item) => item.id === event.activity.id,
    );
    if (index < 0) message.activities.push(event.activity);
    else message.activities[index] = event.activity;
  }
  if (event.type === 'done') {
    message.context = event.context ?? null;
    message.tryOnResult = event.tryOnResult ?? null;
    message.tryOnStatus =
      event.tryOnStatus ?? (event.tryOnResult ? null : message.tryOnStatus);
    finishTurn(message, 'saved');
  } else if (event.type !== 'start' && event.type !== 'error') {
    message.status = 'streaming';
  }
}

/** 所有非成功终态共用清理，避免工具在取消或断流后一直显示执行中。 */
export function finishTurn(message: ChatMessage, status: ChatTurnStatus): void {
  message.status = status;
  message.activities = message.activities.map((activity) =>
    activity.type === 'tool' && activity.status === 'running'
      ? { ...activity, status: 'interrupted' }
      : activity,
  );
}
