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
    context: message.context ?? null,
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
    context: null,
    status: 'submitted',
  };
}

export function applyTurnEvent(
  message: ChatMessage,
  event: ChatStreamEvent,
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
  if (event.type === 'done') {
    message.context = event.context ?? null;
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
