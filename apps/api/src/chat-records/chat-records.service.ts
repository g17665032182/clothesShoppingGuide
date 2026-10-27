import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import { ChatDto, ChatMessageRole } from '../llm/dto/chat.dto.js';
import { LlmService, type ChatOutput } from '../llm/llm.service.js';
import type { User } from '../users/user.entity.js';
import { ChatContextService } from './chat-context.service.js';
import { ChatConversation } from './chat-conversation.entity.js';
import { ChatMessage, ChatRecordMessageRole } from './chat-message.entity.js';
import { ChatSummaryService } from './chat-summary.service.js';
import type { AdminChatQueryDto } from './dto/admin-chat-query.dto.js';
import type { PaginationDto } from './dto/pagination.dto.js';

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type ConversationResponse = {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type MessageResponse = {
  id: string;
  conversationId: string;
  role: ChatRecordMessageRole;
  content: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  createdAt: string;
};

export type ConversationDetailResponse = ConversationResponse & {
  messages: Page<MessageResponse>;
};

export type PersistedChatOutput = ChatOutput & {
  conversationId: string;
  title: string;
};

@Injectable()
export class ChatRecordsService {
  public constructor(
    @InjectRepository(ChatConversation)
    private readonly conversations: EntityRepository<ChatConversation>,
    @InjectRepository(ChatMessage)
    private readonly messages: EntityRepository<ChatMessage>,
    private readonly llmService: LlmService,
    private readonly contextService: ChatContextService,
    private readonly summaryService: ChatSummaryService,
  ) {}

  public async chat(user: User, dto: ChatDto): Promise<PersistedChatOutput> {
    const currentUserMessage = [...dto.messages]
      .reverse()
      .find((message) => message.role === ChatMessageRole.USER);
    if (!currentUserMessage) {
      throw new BadRequestException('聊天请求至少需要一条 user 消息');
    }

    const conversation = dto.conversationId
      ? await this.getOwnedConversation(user.id, dto.conversationId)
      : null;
    const history = conversation
      ? await this.messages.find(
          { conversationId: conversation.id },
          { orderBy: { createdAt: 'asc' } },
        )
      : [];
    const systemMessages = dto.messages
      .filter((message) => message.role === ChatMessageRole.SYSTEM)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    let plan = this.contextService.prepare({
      history,
      currentUserMessage: currentUserMessage.content,
      systemMessages,
      contextSummary: conversation?.contextSummary,
      summaryThroughMessageId: conversation?.summaryThroughMessageId,
    });

    if (plan.needsSummary) {
      const summary = await this.summaryService.summarize(
        conversation?.contextSummary ?? null,
        plan.summarySource,
      );
      if (summary && conversation) {
        conversation.contextSummary = summary;
        conversation.summaryThroughMessageId = plan.lastIncludedMessageId;
        plan = this.contextService.prepare({
          history,
          currentUserMessage: currentUserMessage.content,
          systemMessages,
          contextSummary: summary,
          summaryThroughMessageId: plan.lastIncludedMessageId,
        });
      }
    }

    const result = await this.llmService.chat({ messages: plan.messages });
    const persistedConversation =
      conversation ??
      Object.assign(new ChatConversation(), {
        userId: user.id,
        title: this.generateConversationTitle(currentUserMessage.content),
      });
    persistedConversation.updatedAt = new Date();

    const userMessage = Object.assign(new ChatMessage(), {
      conversationId: persistedConversation.id,
      role: ChatRecordMessageRole.USER,
      content: currentUserMessage.content,
    });
    const assistantMessage = Object.assign(new ChatMessage(), {
      conversationId: persistedConversation.id,
      role: ChatRecordMessageRole.ASSISTANT,
      content: result.content,
      model: result.model,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
      totalTokens: result.usage?.totalTokens ?? null,
    });

    const entityManager = this.conversations.getEntityManager();
    await entityManager.transactional(async (transactionalEntityManager) => {
      // 标量外键不会让 MikroORM 自动推断插入顺序，因此先提交会话再提交消息。
      transactionalEntityManager.persist(persistedConversation);
      await transactionalEntityManager.flush();
      transactionalEntityManager.persist([userMessage, assistantMessage]);
      await transactionalEntityManager.flush();
    });

    return {
      ...result,
      conversationId: persistedConversation.id,
      title: persistedConversation.title,
    };
  }

  public async listForUser(
    userId: string,
    pagination: PaginationDto,
  ): Promise<Page<ConversationResponse>> {
    return this.list({ userId }, pagination);
  }

  public async listForAdmin(
    query: AdminChatQueryDto,
  ): Promise<Page<ConversationResponse>> {
    return this.list(query.userId ? { userId: query.userId } : {}, query);
  }

  public async getForUser(
    userId: string,
    id: string,
    pagination: PaginationDto,
  ): Promise<ConversationDetailResponse> {
    return this.getDetail({ userId, id }, pagination);
  }

  public async getForAdmin(
    id: string,
    pagination: PaginationDto,
  ): Promise<ConversationDetailResponse> {
    return this.getDetail({ id }, pagination);
  }

  public async deleteForUser(userId: string, id: string): Promise<void> {
    const conversation = await this.getOwnedConversation(userId, id);
    const entityManager = this.conversations.getEntityManager();
    entityManager.remove(conversation);
    await entityManager.flush();
  }

  public generateConversationTitle(content: string): string {
    const normalized = content.replace(/\s+/gu, ' ').trim();
    const characters = Array.from(normalized);
    return characters.length > 30
      ? `${characters.slice(0, 30).join('')}...`
      : characters.join('');
  }

  private async list(
    where: { userId?: string },
    pagination: PaginationDto,
  ): Promise<Page<ConversationResponse>> {
    const [items, total] = await this.conversations.findAndCount(where, {
      orderBy: { updatedAt: 'desc' },
      limit: pagination.normalizedPageSize,
      offset: pagination.offset,
    });
    return {
      items: items.map((item) => this.toConversationResponse(item)),
      total,
      page: pagination.normalizedPage,
      pageSize: pagination.normalizedPageSize,
      totalPages: Math.ceil(total / pagination.normalizedPageSize),
    };
  }

  private async getDetail(
    where: { userId?: string; id: string },
    pagination: PaginationDto,
  ): Promise<ConversationDetailResponse> {
    const conversation = await this.conversations.findOne(where);
    if (!conversation) {
      throw new NotFoundException('聊天会话不存在');
    }
    const [messages, total] = await this.messages.findAndCount(
      { conversationId: conversation.id },
      {
        orderBy: { createdAt: 'asc' },
        limit: pagination.normalizedPageSize,
        offset: pagination.offset,
      },
    );
    return {
      ...this.toConversationResponse(conversation),
      messages: {
        items: messages.map((item) => this.toMessageResponse(item)),
        total,
        page: pagination.normalizedPage,
        pageSize: pagination.normalizedPageSize,
        totalPages: Math.ceil(total / pagination.normalizedPageSize),
      },
    };
  }

  private async getOwnedConversation(
    userId: string,
    id: string,
  ): Promise<ChatConversation> {
    const conversation = await this.conversations.findOne({ id, userId });
    if (!conversation) {
      throw new NotFoundException('聊天会话不存在');
    }
    return conversation;
  }

  private toConversationResponse(
    conversation: ChatConversation,
  ): ConversationResponse {
    return {
      id: conversation.id,
      userId: conversation.userId,
      title: conversation.title,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }

  private toMessageResponse(message: ChatMessage): MessageResponse {
    return {
      id: message.id,
      conversationId: message.conversationId,
      role: message.role,
      content: message.content,
      model: message.model,
      inputTokens: message.inputTokens,
      outputTokens: message.outputTokens,
      totalTokens: message.totalTokens,
      createdAt: message.createdAt.toISOString(),
    };
  }
}
