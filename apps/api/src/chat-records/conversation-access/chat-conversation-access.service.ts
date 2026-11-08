import { Injectable, NotFoundException } from '@nestjs/common';
import { LockMode, type EntityManager } from '@mikro-orm/core';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { ChatConversation } from '../entity/chat-conversation.entity.js';

/** 会话拥有者提供统一锁入口，购买与消息保存不能复活已删除的会话。 */
@Injectable()
export class ChatConversationAccess {
  public async lockOwnedInTransaction(
    transaction: EntityManager,
    userId: string,
    conversationId: string,
  ): Promise<{ id: string; userId: string }> {
    const row = await transaction.findOne(
      ChatConversation,
      { id: conversationId, userId },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
    );
    if (!row) throw new NotFoundException('聊天会话不存在');
    return { id: row.id, userId: row.userId };
  }
}

@Module({
  imports: [MikroOrmModule.forFeature([ChatConversation])],
  providers: [ChatConversationAccess],
  exports: [ChatConversationAccess],
})
export class ChatConversationAccessModule {}
