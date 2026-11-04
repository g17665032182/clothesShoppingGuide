import {
  UserMemoryTaskStatus,
  type UserMemoryTask,
} from '../entity/user-memory-task.entity.js';

export function memoryTaskLeaseWhere(task: UserMemoryTask) {
  return {
    id: task.id,
    status: UserMemoryTaskStatus.PROCESSING,
    attempts: task.attempts,
    lockedAt: task.lockedAt,
  };
}
