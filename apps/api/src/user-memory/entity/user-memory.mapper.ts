import type { MemoryResponse } from '../dto/user-memory.dto.js';
import { UserMemory, UserMemoryStatus } from './user-memory.entity.js';
import { getMemoryValueType } from '../context/memory-value.schema.js';

export function toMemoryResponse(memory: UserMemory): MemoryResponse {
  if (memory.status !== UserMemoryStatus.ACTIVE) {
    throw new Error('已删除记忆不得映射为公开响应');
  }

  return {
    id: memory.id,
    category: memory.category,
    valueType: getMemoryValueType(memory.category),
    value: memory.value,
    isPrimary: memory.isPrimary,
    source: memory.sourceStatus
      ? {
          conversationId: memory.sourceConversationId,
          status: memory.sourceStatus,
        }
      : null,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  };
}
