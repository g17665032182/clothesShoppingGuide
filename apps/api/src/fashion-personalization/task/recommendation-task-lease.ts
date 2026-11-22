import {
  RecommendationProfileTaskStatus,
  type RecommendationProfileTask,
} from '../entity/recommendation-profile-task.entity.js';

export function recommendationTaskLeaseWhere(task: RecommendationProfileTask) {
  return {
    id: task.id,
    status: RecommendationProfileTaskStatus.PROCESSING,
    attempts: task.attempts,
    lockedAt: task.lockedAt,
    lockToken: task.lockToken,
  };
}
