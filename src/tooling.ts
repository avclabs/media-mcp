import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { MAX_SYNC_WAIT_BUDGET_MS } from './service-config.js';

// ---------------------------------------------------------------------------
// Tool registration wrapper: business failures surface as MCP isError results
// ---------------------------------------------------------------------------

export function registerTool(
  server: McpServer,
  name: string,
  description: string,
  schema: z.ZodRawShape,
  handler: (args: any) => Promise<unknown>
): void {
  server.tool(name, description, schema, async (args): Promise<CallToolResult> => {
    try {
      const result = await handler(args);
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      const failed = typeof result === 'object' && result !== null && (result as { success?: unknown }).success === false;
      return { content: [{ type: 'text' as const, text }], ...(failed ? { isError: true } : {}) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message }, null, 2) }],
        isError: true,
      };
    }
  });
}

// ---------------------------------------------------------------------------
// Polling primitives
// ---------------------------------------------------------------------------

export const POLL_REQUEST_TIMEOUT_MS = 10000;
export const MAX_CONSECUTIVE_POLL_FAILURES = 3;
export const MAX_UNKNOWN_STATUS_SIGHTINGS = 3;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function remainingSleepMs(intervalMs: number, deadline: number, now: number = Date.now()): number {
  return Math.max(0, Math.min(intervalMs, deadline - now));
}

// A single status request never outlives the remaining wait budget (and never
// runs with timeout 0, which axios treats as "no timeout").
export function requestBudgetMs(deadline: number, now: number = Date.now()): number {
  return Math.max(250, Math.min(POLL_REQUEST_TIMEOUT_MS, deadline - now));
}

const TERMINAL_OK_STATUSES = new Set(['completed', 'succeeded', 'success']);
const TERMINAL_FAIL_STATUSES = new Set(['failed', 'canceled', 'cancelled', 'expired', 'rejected']);
const TRANSIENT_STATUSES = new Set(['processing', 'pending', 'running', 'queued']);

export type StatusKind = 'ok' | 'failed' | 'processing' | 'unknown';

export function classifyStatus(status: unknown): StatusKind {
  const normalized = typeof status === 'string' ? status.toLowerCase() : '';
  if (TERMINAL_OK_STATUSES.has(normalized)) return 'ok';
  if (TERMINAL_FAIL_STATUSES.has(normalized)) return 'failed';
  if (TRANSIENT_STATUSES.has(normalized)) return 'processing';
  return 'unknown';
}

export interface PollFetchResult {
  status: unknown;
  payload: Record<string, any>;
}

export interface PollParams {
  taskId: string;
  timeoutSeconds: number;
  pollIntervalSeconds: number;
  fetchStatus: (signal: AbortSignal) => Promise<PollFetchResult>;
  continueHint: string;
}

/**
 * Deadline-aware polling: never sleeps past the deadline, aborts each status
 * request at the remaining wait budget, tolerates transient network failures,
 * treats unknown statuses as errors after a few sightings, and always keeps
 * task_id in the response so the task is never lost.
 */
export async function pollUntilTerminal(params: PollParams): Promise<Record<string, any>> {
  const timeoutSeconds = clampNumber(params.timeoutSeconds, 1, MAX_SYNC_WAIT_BUDGET_MS / 1000, MAX_SYNC_WAIT_BUDGET_MS / 1000);
  const intervalMs = clampNumber(params.pollIntervalSeconds, 0.5, 30, 5) * 1000;
  const deadline = Date.now() + timeoutSeconds * 1000;
  let consecutiveFailures = 0;
  let unknownSightings = 0;

  while (Date.now() < deadline) {
    const requestBudget = requestBudgetMs(deadline);
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), requestBudget);
    const budgetExceeded = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => reject(new Error(`Status request aborted at the wait budget edge (capped at ${requestBudget} ms)`)),
        { once: true }
      );
    });

    let fetched: PollFetchResult;
    try {
      fetched = await Promise.race([params.fetchStatus(controller.signal), budgetExceeded]);
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        return {
          success: false,
          task_id: params.taskId,
          status: 'unknown',
          error: `Status polling failed ${consecutiveFailures} times in a row: ${error instanceof Error ? error.message : String(error)}`,
          note: `The task has been created and may still be running. Use ${params.continueHint} with this task_id to follow up.`,
        };
      }
      await sleep(remainingSleepMs(intervalMs, deadline));
      continue;
    } finally {
      clearTimeout(abortTimer);
    }

    const kind = classifyStatus(fetched.status);
    if (kind === 'ok') {
      return { success: true, task_id: params.taskId, status: fetched.status, ...fetched.payload };
    }
    if (kind === 'failed') {
      return { success: false, task_id: params.taskId, status: fetched.status, ...fetched.payload };
    }
    if (kind === 'unknown') {
      unknownSightings++;
      if (unknownSightings >= MAX_UNKNOWN_STATUS_SIGHTINGS) {
        return {
          success: false,
          task_id: params.taskId,
          status: fetched.status ?? 'unknown',
          error: `Unrecognized task status: ${JSON.stringify(fetched.status)}`,
          note: `The backend reported an unknown status. Use ${params.continueHint} with this task_id to follow up manually.`,
        };
      }
    }
    await sleep(remainingSleepMs(intervalMs, deadline));
  }

  return {
    success: true,
    status: 'processing',
    task_id: params.taskId,
    message: `Task is still processing (waited ${timeoutSeconds} seconds). Please use ${params.continueHint} to continue polling.`,
    note: 'The synchronous wait for this long-running task has been truncated. Switch to task status polling.',
  };
}
