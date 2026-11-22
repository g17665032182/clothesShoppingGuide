export const RECOMMENDATION_PROFILE_TASK_BATCH_SIZE = 10;
export const RECOMMENDATION_PROFILE_TASK_DEBOUNCE_MS = 10_000;
export const RECOMMENDATION_PROFILE_TASK_PROCESSING_TIMEOUT_MS = 30_000;
export const RECOMMENDATION_PROFILE_TASK_MAX_ATTEMPTS = 3;
export const RECOMMENDATION_FEEDBACK_RETENTION_DAYS = 180;

const retryDelaysMs = [30_000, 120_000] as const;

export function recommendationTaskRetryDelay(attempts: number): number {
  return retryDelaysMs[
    Math.max(0, Math.min(attempts - 1, retryDelaysMs.length - 1))
  ]!;
}
