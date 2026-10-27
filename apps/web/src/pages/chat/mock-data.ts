import type { ChatMessage, Conversation } from '@/api/types/chat';

export const conversations: Conversation[] = [
  {
    id: 1,
    title: '秋季通勤穿搭',
    preview: '帮我挑一套适合通勤的搭配',
    updatedAt: '刚刚',
  },
  {
    id: 2,
    title: '衣橱整理建议',
    preview: '哪些基础款值得优先保留？',
    updatedAt: '昨天',
  },
];

export function formatChatTime(date = new Date()): string {
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function createConversationMessages(
  conversationId: number,
): ChatMessage[] {
  if (conversationId === 2) {
    return [
      {
        id: 101,
        role: 'assistant',
        content: '可以先从衣橱里的高频单品开始，看看哪些衣服最常被穿到。',
        time: formatChatTime(),
      },
      {
        id: 102,
        role: 'user',
        content: '我有一件白衬衫和一条深色牛仔裤。',
        time: formatChatTime(),
      },
      {
        id: 103,
        role: 'assistant',
        content:
          '这两件都属于很好的基础款，可以继续保留，再补一件轻薄针织开衫来增加搭配层次。',
        time: formatChatTime(),
      },
    ];
  }

  if (conversationId === 0) {
    return [
      {
        id: 201,
        role: 'assistant',
        content:
          '你好，我是你的穿搭顾问。告诉我你的场合、天气和偏好，我会帮你整理出更适合的选择。',
        time: formatChatTime(),
      },
    ];
  }

  return [
    {
      id: 1,
      role: 'assistant',
      content:
        '你好，我是你的穿搭顾问。告诉我你的场合、天气和偏好，我会帮你整理出更适合的选择。',
      time: '10:24',
    },
    {
      id: 2,
      role: 'user',
      content: '帮我挑一套适合秋季通勤的搭配，想要舒服一点。',
      time: '10:25',
    },
    {
      id: 3,
      role: 'assistant',
      content: `可以从一件**轻薄针织衫**开始，搭配高腰直筒裤和低帮乐福鞋。

- 颜色：燕麦色、深灰或藏蓝
- 外套：短款风衣或简洁西装
- 配饰：小尺寸皮质托特包

这样既保留通勤感，也方便应对早晚温差。`,
      time: '10:25',
    },
  ];
}
