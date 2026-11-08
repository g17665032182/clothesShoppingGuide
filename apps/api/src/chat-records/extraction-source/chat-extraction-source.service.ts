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
  ChatExtractionTurn,
} from './chat-extraction-source.port.js';

@Injectable()
export class ChatExtractionSourceService implements ChatExtractionSource {
  public constructor(
    @InjectRepository(ChatConversation)
    private readonly conversations: EntityRepository<ChatConversation>,
    private readonly users: UsersService,
  ) {}

  public async ownsConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<boolean> {
    if (!(await this.users.isActive(input.userId))) return false;
    return Boolean(
      await this.conversations.findOne({
        id: input.conversationId,
        userId: input.userId,
      }),
    );
  }

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
      if (
        !userMessage ||
        !assistantMessage ||
        !userMessage.memoryExtractionEligible ||
        !assistantMessage.memoryExtractionEligible
      )
        return null;
      return {
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        userMessage: userMessage.content,
        assistantMessage: assistantMessage.content,
      };
    });
  }

  public async readTurns(input: {
    userId: string;
    conversationId: string;
    turns: ChatExtractionTurn[];
  }) {
    if (!(await this.users.isActive(input.userId))) return null;
    const entityManager = this.conversations.getEntityManager().fork();
    return entityManager.transactional(async (transaction) => {
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
      if (input.turns.length === 0) return [];
      const userIds = input.turns.map((turn) => turn.userMessageId);
      const assistantIds = input.turns.map((turn) => turn.assistantMessageId);
      const users = await transaction.find(ChatMessage, {
        id: { $in: userIds },
        conversationId: input.conversationId,
        role: ChatRecordMessageRole.USER,
      });
      const assistants = await transaction.find(ChatMessage, {
        id: { $in: assistantIds },
        conversationId: input.conversationId,
        role: ChatRecordMessageRole.ASSISTANT,
      });
      const usersById = new Map(users.map((message) => [message.id, message]));
      const assistantsById = new Map(
        assistants.map((message) => [message.id, message]),
      );
      const result = input.turns.map((turn) => {
        const userMessage = usersById.get(turn.userMessageId);
        const assistantMessage = assistantsById.get(turn.assistantMessageId);
        if (!userMessage || !assistantMessage) return null;
        if (
          !userMessage.memoryExtractionEligible ||
          !assistantMessage.memoryExtractionEligible
        )
          return undefined;
        return {
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          userMessage: userMessage.content,
          assistantMessage: assistantMessage.content,
        };
      });
      if (result.some((turn) => turn === null)) return null;
      return result.flatMap((turn) => (turn ? [turn] : []));
    });
  }
}
