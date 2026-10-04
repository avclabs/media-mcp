export function resolveImageBaseUrl(imageBaseUrl: string | undefined, videoBaseUrl: string): string {
  const configuredImageBaseUrl = imageBaseUrl?.trim();
  return configuredImageBaseUrl || videoBaseUrl;
}

export const MAX_SYNC_WAIT_BUDGET_MS = 45000;

export interface Sam3WaitBudget {
  maxAttempts: number;
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
  const declaredMs = pollIntervalMs * requestedMaxAttempts;
  if (declaredMs <= maxBudgetMs) {
    return { maxAttempts: requestedMaxAttempts, clamped: false };
  }
  const attempts = Math.max(1, Math.floor(maxBudgetMs / pollIntervalMs));
  if (options.note) {
    if (attempts * pollIntervalMs > maxBudgetMs) {
      options.note(
        `SAM3 sync wait budget is capped at ${maxBudgetMs} ms: poll interval ${pollIntervalMs} ms x max attempts ${attempts} = ${attempts * pollIntervalMs} ms; the wait will be truncated at ${maxBudgetMs} ms. Lower SAM3_POLL_INTERVAL_MS to fit the cap.`
      );
    } else {
      options.note(
        `SAM3 sync wait budget is capped at ${maxBudgetMs} ms: poll interval ${pollIntervalMs} ms x max attempts ${requestedMaxAttempts} = ${declaredMs} ms; max attempts reduced to ${attempts} (budget ${attempts * pollIntervalMs} ms). Lower SAM3_POLL_INTERVAL_MS to keep more attempts within the cap.`
      );
    }
  }
  return { maxAttempts: attempts, clamped: true };
}
