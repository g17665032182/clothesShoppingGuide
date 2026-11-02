export const MEMORY_TASK_MAX_ATTEMPTS = 4;

const retryDelaysMs = [60_000, 5 * 60_000, 30 * 60_000] as const;

export function memoryTaskRetryDelay(attempts: number): number {
  return retryDelaysMs[
    Math.max(0, Math.min(attempts - 1, retryDelaysMs.length - 1))
  ]!;
}

export function memoryTaskCanRetry(attempts: number): boolean {
  return attempts < MEMORY_TASK_MAX_ATTEMPTS;
}
