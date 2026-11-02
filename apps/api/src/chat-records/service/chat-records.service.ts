import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';

import { ChatMessageRole, type ChatInput } from '../../llm/dto/chat.dto.js';
import { LlmService, type ChatOutput } from '../../llm/service/llm.service.js';
import type { LlmTraceEvent } from '../../llm/trace/llm-trace.types.js';
import { mapTraceEventsToMessages } from '../history/chat-history.mapper.js';
import type { User } from '../../users/entity/user.entity.js';
import { ChatContextService } from '../context/chat-context.service.js';
import { ChatConversation } from '../entity/chat-conversation.entity.js';
import {
  ChatMessage,
  ChatRecordMessageRole,
} from '../entity/chat-message.entity.js';
import { ChatSummaryService } from './chat-summary.service.js';
import { ChatTraceEvent } from '../entity/chat-trace-event.entity.js';
import { ChatTraceWriterService } from '../trace/chat-trace-writer.service.js';
import type { AdminChatQueryDto } from '../dto/admin-chat-query.dto.js';
import type { PaginationDto } from '../dto/pagination.dto.js';

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

export type ChatStreamEvent =
  | {
      type: 'start';
      conversationId: string;
      title: string;
    }
  | {
      type: 'delta';
      content: string;
    }
  | {
      type: 'done';
      conversationId: string;
      title: string;
      model: string;
      usage: ChatOutput['usage'];
    };

type PreparedChat = {
  conversation: ChatConversation | null;
  persistedConversation: ChatConversation;
  currentUserMessage: string;
  runId: string;
  traceWriter: ChatTraceWriterService;
  plan: ReturnType<ChatContextService['prepare']>;
  nextContextSummary: string | null | undefined;
  nextSummaryThroughMessageId: string | null | undefined;
};

@Injectable()
export class ChatRecordsService {
  public constructor(
    @InjectRepository(ChatConversation)
    private readonly conversations: EntityRepository<ChatConversation>,
    @InjectRepository(ChatMessage)
    private readonly messages: EntityRepository<ChatMessage>,
    @InjectRepository(ChatTraceEvent)
    private readonly traceEvents: EntityRepository<ChatTraceEvent>,
    private readonly llmService: LlmService,
    private readonly contextService: ChatContextService,
    private readonly summaryService: ChatSummaryService,
    private readonly traceWriter: ChatTraceWriterService,
  ) {}

  public async chat(user: User, dto: ChatInput): Promise<PersistedChatOutput> {
    const prepared = await this.prepareChat(user, dto);
    await this.ensureConversationPersisted(prepared);
    const result = await this.llmService.chat(
      {
        messages: prepared.plan.messages,
      },
      this.traceContext(prepared),
    );
    await this.persistChat(prepared, result);

    return {
      ...result,
      conversationId: prepared.persistedConversation.id,
      title: prepared.persistedConversation.title,
    };
  }

  public async prepareStream(
    user: User,
    dto: ChatInput,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<ChatStreamEvent>> {
    const prepared = await this.prepareChat(user, dto);
    return this.streamPrepared(prepared, signal);
  }

  private async *streamPrepared(
    prepared: PreparedChat,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    if (signal?.aborted) {
      throw new DOMException('The operation was aborted', 'AbortError');
    }
    await this.ensureConversationPersisted(prepared);
    let persistedMessages = false;
    try {
      yield {
        type: 'start',
        conversationId: prepared.persistedConversation.id,
        title: prepared.persistedConversation.title,
      };
      if (signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }

      const resultIterator = this.llmService.stream(
        { messages: prepared.plan.messages },
        signal,
        this.traceContext(prepared, signal),
      );
      let result: ChatOutput | undefined;
      while (true) {
        const next = await resultIterator.next();
        if (next.done) {
          result = next.value;
          break;
        }
        if (next.value) {
          yield { type: 'delta', content: next.value };
        }
      }

      if (!result || signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }

      await this.persistChat(prepared, result);
      persistedMessages = true;
      yield {
        type: 'done',
        conversationId: prepared.persistedConversation.id,
        title: prepared.persistedConversation.title,
        model: result.model,
        usage: result.usage,
      };
    } finally {
      if (
        !persistedMessages &&
        signal?.aborted &&
        prepared.conversation === null
      ) {
        await this.deleteConversation(prepared.persistedConversation);
      }
    }
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

  private async prepareChat(user: User, dto: ChatInput): Promise<PreparedChat> {
    this.llmService.assertConfigured();
    const currentUserMessage = [...dto.messages]
      .reverse()
      .find((message) => message.role === ChatMessageRole.USER);
    if (!currentUserMessage) {
      throw new BadRequestException('聊天请求至少需要一条 user 消息');
    }

    const conversation = dto.conversationId
      ? await this.getOwnedConversation(user.id, dto.conversationId)
      : null;
    const legacyMessages = conversation
      ? await this.messages.find(
          { conversationId: conversation.id },
          { orderBy: { createdAt: 'asc' } },
        )
      : [];
    let traceHistory = conversation
      ? await this.traceEvents.find(
          { conversationId: conversation.id },
          { orderBy: { createdAt: 'asc', sequence: 'asc' } },
        )
      : [];
    if (
      conversation &&
      traceHistory.length === 0 &&
      legacyMessages.length > 0
    ) {
      const legacyRunId = '00000000-0000-4000-8000-000000000001';
      const legacyEvents = legacyMessages.reduce<LlmTraceEvent[]>(
        (events, message, sequence) => {
          if (message.role === ChatRecordMessageRole.USER) {
            events.push({
              sequence,
              type: 'input',
              messageId: message.id,
              content: message.content,
            });
          } else {
            events.push({
              sequence,
              type: 'model_response',
              messageId: message.id,
              content: message.content,
              model: message.model,
              usage: {
                inputTokens: message.inputTokens,
                outputTokens: message.outputTokens,
                totalTokens: message.totalTokens,
              },
            });
          }
          return events;
        },
        [],
      );
      await this.traceWriter.writeEvents(
        { conversationId: conversation.id, runId: legacyRunId },
        legacyEvents,
      );
      traceHistory = await this.traceEvents.find(
        { conversationId: conversation.id },
        { orderBy: { createdAt: 'asc', sequence: 'asc' } },
      );
    }
    const history = conversation ? mapTraceEventsToMessages(traceHistory) : [];
    const systemMessages = dto.messages
      .filter((message) => message.role === ChatMessageRole.SYSTEM)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    let plan = this.contextService.prepare({
      history: legacyMessages,
      messageHistory: history,
      currentUserMessage: currentUserMessage.content,
      systemMessages,
      contextSummary: conversation?.contextSummary,
      summaryThroughMessageId: conversation?.summaryThroughMessageId,
    });

    let nextContextSummary: string | null | undefined;
    let nextSummaryThroughMessageId: string | null | undefined;
    if (plan.needsSummary) {
      const summary = await this.summaryService.summarize(
        conversation?.contextSummary ?? null,
        plan.messageSummarySource ?? plan.summarySource,
      );
      if (summary && conversation) {
        nextContextSummary = summary;
        nextSummaryThroughMessageId = plan.lastIncludedMessageId;
        plan = this.contextService.prepare({
          history: legacyMessages,
          messageHistory: history,
          currentUserMessage: currentUserMessage.content,
          systemMessages,
          contextSummary: summary,
          summaryThroughMessageId: plan.lastIncludedMessageId,
        });
      }
    }

    const persistedConversation =
      conversation ??
      Object.assign(new ChatConversation(), {
        userId: user.id,
        title: this.generateConversationTitle(currentUserMessage.content),
      });
    return {
      conversation,
      persistedConversation,
      currentUserMessage: currentUserMessage.content,
      runId: randomUUID(),
      traceWriter: this.traceWriter,
      plan,
      nextContextSummary,
      nextSummaryThroughMessageId,
    };
  }

  private traceContext(prepared: PreparedChat, signal?: AbortSignal) {
    return {
      conversationId: prepared.persistedConversation.id,
      runId: prepared.runId,
      writer: prepared.traceWriter,
      model: this.llmService.assertConfigured(),
      ...(signal ? { signal } : {}),
    };
  }

  private async ensureConversationPersisted(
    prepared: PreparedChat,
  ): Promise<void> {
    if (prepared.conversation) return;
    const entityManager = this.conversations.getEntityManager();
    entityManager.persist(prepared.persistedConversation);
    await entityManager.flush();
  }

  private async deleteConversation(
    conversation: ChatConversation,
  ): Promise<void> {
    const entityManager = this.conversations.getEntityManager();
    entityManager.remove(conversation);
    await entityManager.flush();
  }

  private async persistChat(
    prepared: PreparedChat,
    result: ChatOutput,
  ): Promise<void> {
    const persistedConversation = prepared.persistedConversation;
    persistedConversation.updatedAt = new Date();
    const userMessage = Object.assign(new ChatMessage(), {
      conversationId: persistedConversation.id,
      role: ChatRecordMessageRole.USER,
      content: prepared.currentUserMessage,
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
      if (prepared.nextContextSummary !== undefined) {
        persistedConversation.contextSummary = prepared.nextContextSummary;
        persistedConversation.summaryThroughMessageId =
          prepared.nextSummaryThroughMessageId ?? null;
      }
      transactionalEntityManager.persist(persistedConversation);
      await transactionalEntityManager.flush();
      transactionalEntityManager.persist([userMessage, assistantMessage]);
      await transactionalEntityManager.flush();
    });
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
