import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import { z } from 'zod';
import {
  checkLocalFile,
  formatRequestError,
  parseTosSignature,
  unwrapEnvelope,
  uploadToTos,
} from './tos.js';
import { classifyStatus, POLL_REQUEST_TIMEOUT_MS, pollUntilTerminal, registerTool } from './tooling.js';

const PollIntervalSchema = z.number().min(0.5).max(30).default(5).describe('Polling interval in seconds (0.5-30), default 5');
const SyncTimeoutSchema = z.number().min(1).max(45).default(45).describe('Synchronous wait timeout in seconds (1-45), default 45. Returns task_id early when exceeded, use the task status tool to continue polling');

// Schemas
const CreateTaskSchema = z.object({
  video_source: z.string().describe('Video URL or local file path (URL must be publicly accessible, login or signed links are not supported)'),
  type: z.enum(['url', 'local']).default('url').describe('Upload type: url=remote video, local=local file'),
  resolution: z.enum(['480p', '540p', '720p', '1080p', '2k']).default('720p').describe('Target resolution, default 720p'),
});

const GetTaskStatusSchema = z.object({
  task_id: z.string().describe('Task ID'),
});

const EnhanceVideoSyncSchema = z.object({
  video_source: z.string().describe('Video URL or local file path (URL must be publicly accessible, login or signed links are not supported)'),
  type: z.enum(['url', 'local']).default('url').describe('Upload type: url=remote video, local=local file'),
  resolution: z.enum(['480p', '540p', '720p', '1080p', '2k']).default('720p').describe('Target resolution, default 720p'),
  poll_interval: PollIntervalSchema,
  timeout: SyncTimeoutSchema,
});

export function setupVideoEnhancementTools(server: McpServer, baseUrl: string, apiKey: string): void {
  const client: AxiosInstance = axios.create({
    baseURL: baseUrl.replace(/\/$/, ''),
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  });

  registerTool(
    server,
    'create_task',
    `Create a video enhancement task (asynchronous).

Two upload methods are supported:
1. URL upload: provide a video URL
2. Local upload: provide a local file path, the MCP Server will auto-upload to TOS object storage

Parameters:
- video_source: video URL or local file path
- type: "url" or "local"
- resolution: target resolution

After creating a task, a task_id is returned immediately. Use get_task_status to poll for results until status becomes "completed" or "failed".`,
    CreateTaskSchema.shape,
    async (args) => createTask(client, args.video_source, args.type, args.resolution)
  );

  registerTool(
    server,
    'get_task_status',
    'Query video enhancement task status. The status field can be: processing, completed, or failed. If status is processing, wait a few seconds and call this tool again to poll.',
    GetTaskStatusSchema.shape,
    async (args) => {
      const result = await getTaskStatus(client, args.task_id);
      return {
        ...result,
        // registerTool marks isError on success===false: a terminal failed
        // status is a failed query outcome, not a healthy poll tick.
        success: classifyStatus(result.status) !== 'failed',
        message: result.status === 'processing' ? 'Task is still processing, please check again later' : undefined,
      };
    }
  );

  registerTool(
    server,
    'enhance_video_sync',
    `Synchronously enhance video (blocks until completion).

Two upload methods are supported:
1. URL upload: provide a video URL
2. Local upload: provide a local file path, the MCP Server will auto-upload to TOS object storage

Parameters:
- video_source: video URL or local file path
- type: "url" or "local"
- resolution: target resolution
- poll_interval: polling interval in seconds
- timeout: synchronous wait timeout in seconds, default 45

Best for short videos (estimated processing time < 1 minute). If the task is not completed within the timeout, the tool returns early with a task_id. Use get_task_status to continue polling.`,
    EnhanceVideoSyncSchema.shape,
    async (args) => enhanceVideoSync(client, args.video_source, args.type, args.resolution, args.poll_interval, args.timeout)
  );
}

async function getTosSignature(client: AxiosInstance, fileName: string): Promise<any> {
  const response = await client.post('/api/v3/contents/generations/tos-signature', {
    file_type: 'video',
    file_name: fileName,
  });
  const unwrapped = unwrapEnvelope(response);
  if (!unwrapped.ok) {
    throw new Error(unwrapped.error);
  }
  return unwrapped.data;
}

async function createTask(
  client: AxiosInstance,
  videoSource: string,
  sourceType: 'url' | 'local',
  resolution: string
): Promise<any> {
  let contentItem: any;

  if (sourceType === 'local') {
    const fileInfo = checkLocalFile(videoSource, 'video');

    // Step 1: Get TOS signature
    let target;
    try {
      target = parseTosSignature(await getTosSignature(client, fileInfo.fileName));
    } catch (error: any) {
      throw new Error(`[Step 1: TOS signature failed] ${formatRequestError(error)}`);
    }

    // Step 2: Upload to TOS
    try {
      await uploadToTos(target, fs.createReadStream(videoSource), fileInfo.fileName);
    } catch (error: any) {
      throw new Error(`[Step 2: TOS upload failed] ${error.message}`);
    }

    contentItem = { type: 'video_file', file_id: target.fileId, file_name: fileInfo.fileName };
  } else {
    contentItem = { type: 'video_url', video_url: { url: videoSource } };
  }

  // Step 3: Call video API
  const payload = { model: 'avc-enhance', content: [contentItem], resolution };
  let response;
  try {
    response = await client.post('/api/v3/contents/generations/tasks', payload);
  } catch (error: any) {
    throw new Error(`[Step 3: API call failed] ${formatRequestError(error)}`);
  }
  const unwrapped = unwrapEnvelope(response);
  if (!unwrapped.ok) {
    return { success: false, error: unwrapped.error };
  }
  return { success: true, task_id: unwrapped.data.task_id, status: unwrapped.data.status };
}

async function getTaskStatus(client: AxiosInstance, taskId: string, signal?: AbortSignal): Promise<any> {
  const response = await client.get(`/api/v3/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
    timeout: POLL_REQUEST_TIMEOUT_MS,
    signal,
  });
  const unwrapped = unwrapEnvelope(response);
  if (!unwrapped.ok) {
    throw new Error(unwrapped.error);
  }
  const result = unwrapped.data;
  return {
    task_id: result.task_id,
    status: result.status,
    progress: result.progress ?? 0,
    video_url: result.video_url,
    error_message: result.error_message,
    created_at: result.created_at,
    updated_at: result.updated_at,
  };
}

async function enhanceVideoSync(
  client: AxiosInstance,
  videoSource: string,
  sourceType: 'url' | 'local',
  resolution: string,
  pollInterval: number,
  timeout: number
): Promise<any> {
  const createResult = await createTask(client, videoSource, sourceType, resolution);
  if (!createResult.success) {
    return createResult;
  }

  return pollUntilTerminal({
    taskId: createResult.task_id,
    timeoutSeconds: timeout,
    pollIntervalSeconds: pollInterval,
    continueHint: 'get_task_status',
    fetchStatus: async (signal) => {
      const { task_id, status, ...payload } = await getTaskStatus(client, createResult.task_id, signal);
      return { status, payload };
    },
  });
}
