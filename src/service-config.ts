export function resolveImageBaseUrl(imageBaseUrl: string | undefined, videoBaseUrl: string): string {
  const configuredImageBaseUrl = imageBaseUrl?.trim();
  return configuredImageBaseUrl || videoBaseUrl;
}

export const MAX_SYNC_WAIT_BUDGET_MS = 45000;

export interface Sam3WaitBudget {
  maxAttempts: number;
  budgetMs: number;
  clamped: boolean;
}

// SAM3 derives its wait budget from interval x attempts, while the sync wait
// budget stays capped at MAX_SYNC_WAIT_BUDGET_MS; reduce max attempts up front
// so the two numbers cannot silently disagree.
export function clampSam3WaitBudget(
  pollIntervalMs: number,
  requestedMaxAttempts: number,
  options: { maxBudgetMs?: number; note?: (message: string) => void } = {}
): Sam3WaitBudget {
  const maxBudgetMs = options.maxBudgetMs ?? MAX_SYNC_WAIT_BUDGET_MS;
  const budgetMs = pollIntervalMs * requestedMaxAttempts;
  if (budgetMs <= maxBudgetMs) {
    return { maxAttempts: requestedMaxAttempts, budgetMs, clamped: false };
  }
  const attempts = Math.max(1, Math.floor(maxBudgetMs / pollIntervalMs));
  if (options.note) {
    if (attempts < requestedMaxAttempts) {
      options.note(
        `SAM3 synchronous wait budget is capped at ${maxBudgetMs} ms: poll interval ${pollIntervalMs} ms x max attempts ${requestedMaxAttempts} = ${budgetMs} ms; max attempts reduced to ${attempts} (budget ${attempts * pollIntervalMs} ms). Lower SAM3_POLL_INTERVAL_MS to keep more attempts within the cap.`
      );
    } else {
      options.note(
        `SAM3 poll interval ${pollIntervalMs} ms alone exceeds the ${maxBudgetMs} ms synchronous wait budget; the wait will be truncated at ${maxBudgetMs} ms.`
      );
    }
  }
  return { maxAttempts: attempts, budgetMs: attempts * pollIntervalMs, clamped: true };
}
