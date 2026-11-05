import { getConversation } from '@/api/modules/chat';
import type { ChatMessage } from '@/api/types/chat';
import type { PendingTurn } from './session';

export async function latestDetail(
  token: string,
  id: string,
  signal: AbortSignal,
) {
  let detail = await getConversation(token, id, 1, signal);
  let page = Math.max(1, detail.messages.totalPages);
  if (page > 1) detail = await getConversation(token, id, page, signal);
  // 读取期间若新一轮提交跨页，仅追赶一次，不进行后台轮询。
  if (detail.messages.totalPages > page) {
    page = detail.messages.totalPages;
    detail = await getConversation(token, id, page, signal);
  }
  let items = detail.messages.items;
  if (page > 1 && items.length < 2) {
    const previous = await getConversation(token, id, page - 1, signal);
    items = [...previous.messages.items, ...items];
    page -= 1;
  }
  return { detail, items, page };
}

export function reconcileUncertain(
  turn: PendingTurn,
  saved: ChatMessage[],
): boolean {
  const activityIds = new Set(turn.assistant.activities.map((item) => item.id));
  // 文本相同不能证明是同一轮；仅已持久化的新助手消息及稳定活动 ID 可佐证。
  return (
    activityIds.size > 0 &&
    saved.some(
      (item) =>
        item.role === 'assistant' &&
        !turn.knownMessageIds.has(item.id) &&
        item.activities.some((activity) => activityIds.has(activity.id)),
    )
  );
}

export function mergeSavedMessages(
  rendered: ChatMessage[],
  saved: ChatMessage[],
  turn: PendingTurn,
): ChatMessage[] {
  const renderedKeys = new Map(
    rendered.map((item) => [item.id, item.renderKey]),
  );
  for (const item of saved) item.renderKey = renderedKeys.get(item.id);
  const last = [...saved].reverse().find((item) => item.role === 'assistant');
  if (last && last.content === turn.assistant.content) {
    last.renderKey = turn.assistant.id;
    if (turn.assistant.duration) last.duration = turn.assistant.duration;
    const previous = saved[saved.indexOf(last) - 1];
    if (previous?.role === 'user' && previous.content === turn.user.content)
      previous.renderKey = turn.user.id;
  }
  const receivedIds = new Set(saved.map((item) => item.id));
  return [
    ...rendered.filter(
      (item) =>
        item.status === 'saved' &&
        item.id !== turn.user.id &&
        item.id !== turn.assistant.id &&
        !receivedIds.has(item.id),
    ),
    ...saved,
  ];
}
