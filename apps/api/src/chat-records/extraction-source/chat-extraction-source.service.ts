import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import { UsersService } from '../../users/index.js';
import { ChatConversation } from '../entity/chat-conversation.entity.js';
import {
  ChatMessage,
  ChatRecordMessageRole,
} from '../entity/chat-message.entity.js';
import type {
  ChatExtractionInput,
  ChatExtractionSource,
} from './chat-extraction-source.port.js';

@Injectable()
export class ChatExtractionSourceService implements ChatExtractionSource {
  public constructor(
    @InjectRepository(ChatConversation)
    private readonly conversations: EntityRepository<ChatConversation>,
    private readonly users: UsersService,
  ) {}

  public async readTurn(input: ChatExtractionInput) {
    if (!(await this.users.isActive(input.userId))) return null;
    const entityManager = this.conversations.getEntityManager().fork();
    return entityManager.transactional(async (transaction) => {
      // 来源查询有界执行，且只向领域提取器提供已授权的可见消息。
      await transaction
        .getConnection()
        .execute(
          "set local statement_timeout = '5s'",
          [],
          'run',
          transaction.getTransactionContext(),
        );
      const conversation = await transaction.findOne(ChatConversation, {
        id: input.conversationId,
        userId: input.userId,
      });
      if (!conversation) return null;
      const userMessage = await transaction.findOne(ChatMessage, {
        id: input.userMessageId,
        conversationId: input.conversationId,
        role: ChatRecordMessageRole.USER,
      });
      const assistantMessage = await transaction.findOne(ChatMessage, {
        id: input.assistantMessageId,
        conversationId: input.conversationId,
        role: ChatRecordMessageRole.ASSISTANT,
      });
      if (!userMessage || !assistantMessage) return null;
      return {
        userMessage: userMessage.content,
        assistantMessage: assistantMessage.content,
      };
    });
  }
}
