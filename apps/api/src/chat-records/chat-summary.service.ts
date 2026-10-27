import { Injectable, Logger } from '@nestjs/common';

import { LlmService } from '../llm/llm.service.js';
import { ChatContextService } from './chat-context.service.js';
import type { ChatMessage } from './chat-message.entity.js';

@Injectable()
export class ChatSummaryService {
  private readonly logger = new Logger(ChatSummaryService.name);

  public constructor(
    private readonly llmService: LlmService,
    private readonly contextService: ChatContextService,
  ) {}

  public async summarize(
    existingSummary: string | null,
    messages: ChatMessage[],
  ): Promise<string | null> {
    if (messages.length === 0) {
      return existingSummary;
    }
    const transcript = messages
      .map((message) => `${message.role}: ${message.content}`)
      .join('\n');
    try {
      const result = await this.llmService.chat({
        messages: [
          {
            role: 'system',
            content:
              '请把聊天历史压缩为中文结构化摘要。固定包含：目标、事实、约束、决定、未解决问题。只输出摘要，不要寒暄。',
          },
          {
            role: 'user',
            content: [
              existingSummary ? `已有摘要：\n${existingSummary}` : '',
              `新增聊天记录：\n${transcript}`,
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
      });
      return this.contextService.truncateToTokens(result.content, 1024);
    } catch (error) {
      // 摘要只是性能优化，失败时由调用方继续使用最近消息。
      this.logger.warn(
        `聊天上下文摘要失败: ${
          error instanceof Error ? error.constructor.name : 'UnknownError'
        }`,
      );
      return null;
    }
  }
}
