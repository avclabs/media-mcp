import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import FormData from 'form-data';

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
  poll_interval: z.number().default(5).describe('Polling interval in seconds, default 5'),
  timeout: z.number().default(50).describe('Synchronous wait timeout in seconds, default 50. Returns task_id early when exceeded, use get_task_status to continue polling'),
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

  // create_task tool
  server.tool(
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
    async (args) => {
      try {
        const result = await createTask(client, args.video_source, args.type, args.resolution);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: errorMessage }, null, 2) }],
        };
      }
    }
  );

  // get_task_status tool
  server.tool(
    'get_task_status',
    'Query video enhancement task status. The status field can be: processing, completed, or failed. If status is processing, wait a few seconds and call this tool again to poll.',
    GetTaskStatusSchema.shape,
    async (args) => {
      try {
        const result = await getTaskStatus(client, args.task_id);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: errorMessage }, null, 2) }],
        };
      }
    }
  );

  // enhance_video_sync tool
  server.tool(
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
- timeout: synchronous wait timeout in seconds, default 50

Best for short videos (estimated processing time < 1 minute). If the task is not completed within 50 seconds, the tool returns early with a task_id. Use get_task_status to continue polling.`,
    EnhanceVideoSyncSchema.shape,
    async (args) => {
      try {
        const result = await enhanceVideoSync(
          client,
          args.video_source,
          args.type,
          args.resolution,
          args.poll_interval,
          args.timeout
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: errorMessage }, null, 2) }],
        };
      }
    }
  );
}

function checkLocalFile(filePath: string): { filePath: string; fileName: string } {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  const stats = fs.statSync(filePath);
  const maxSize = 100 * 1024 * 1024;
  if (stats.size > maxSize) {
    throw new Error('File size exceeds 100MB limit');
  }
  return { filePath, fileName: path.basename(filePath) };
}

async function getTosSignature(client: AxiosInstance, fileName: string): Promise<any> {
  const response = await client.post('/api/v3/contents/generations/tos-signature', {
    file_type: 'video',
    file_name: fileName,
  });
  const data = response.data;
  if (data.code !== 0 && data.code !== 200) {
    throw new Error(data.message || 'Failed to get TOS signature');
  }
  return data.data;
}

async function uploadToTos(filePath: string, signatureData: any): Promise<void> {
  const formData = new FormData();
  const objectKey = decodeURIComponent(new URL(signatureData.url).pathname.slice(1));
  formData.append('key', objectKey);

  const fieldMapping: Record<string, string> = {
    algorithm: 'x-tos-algorithm',
    credential: 'x-tos-credential',
    date: 'x-tos-date',
    signature: 'x-tos-signature',
  };

  for (const [key, value] of Object.entries(signatureData)) {
    if (key === 'url' || key === 'origin_policy') continue;
    const formKey = fieldMapping[key] || key;
    formData.append(formKey, String(value));
  }

  const fileName = path.basename(filePath);
  formData.append('file', fs.createReadStream(filePath), fileName);

  const response = await axios.post(signatureData.url, formData, {
    headers: formData.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  if (response.status >= 400) {
    const debugInfo = JSON.stringify({
      status: response.status,
      statusText: response.statusText,
      data: response.data,
      url: signatureData.url,
      signatureFields: Object.keys(signatureData),
      fileName,
      fileSize: fs.statSync(filePath).size,
    }, null, 2);
    throw new Error(`TOS upload failed: ${response.status} ${response.statusText}\nDebug info: ${debugInfo}`);
  }
}

function parseFileIdFromUrl(url: string): string {
  const pathname = new URL(url).pathname;
  const segments = pathname.split('/');
  return decodeURIComponent(segments.pop() || '');
}

async function createTask(
  client: AxiosInstance,
  videoSource: string,
  sourceType: string,
  resolution: string
): Promise<any> {
  let contentItem: any;

  if (sourceType === 'local') {
    const fileInfo = checkLocalFile(videoSource);
    const signatureData = await getTosSignature(client, fileInfo.fileName);
    await uploadToTos(videoSource, signatureData);
    const fileId = parseFileIdFromUrl(signatureData.url);
    contentItem = { type: 'video_file', file_id: fileId, file_name: fileInfo.fileName };
  } else {
    contentItem = { type: 'video_url', video_url: { url: videoSource } };
  }

  const payload = { model: 'avc-enhance', content: [contentItem], resolution };
  const response = await client.post('/api/v3/contents/generations/tasks', payload);
  const data = response.data;

  if (data.code !== 0 && data.code !== 200) {
    return { success: false, error: data.message };
  }
  return { success: true, task_id: data.data.task_id, status: data.data.status };
}

async function getTaskStatus(client: AxiosInstance, taskId: string): Promise<any> {
  const response = await client.get(`/api/v3/contents/generations/tasks/${taskId}`);
  const data = response.data;

  if (data.code !== 0 && data.code !== 200) {
    return { success: false, error: data.message };
  }

  const result = data.data;
  return {
    success: true,
    task_id: result.task_id,
    status: result.status,
    progress: result.progress || 0,
    video_url: result.video_url,
    debug_video_url_length: result.video_url?.length,
    debug_video_url_full: result.video_url,
    error_message: result.error_message,
    created_at: result.created_at,
    updated_at: result.updated_at,
    message: result.status === 'processing' ? 'Task is still processing, please check again later' : undefined,
  };
}

async function enhanceVideoSync(
  client: AxiosInstance,
  videoSource: string,
  sourceType: string,
  resolution: string,
  pollInterval: number,
  timeout: number
): Promise<any> {
  const createResult = await createTask(client, videoSource, sourceType, resolution);
  if (!createResult.success) {
    return createResult;
  }

  const taskId = createResult.task_id;
  const startTime = Date.now();
  while (true) {
    const status = await getTaskStatus(client, taskId);
    if (!status.success) {
      return status;
    }
    if (status.status === 'completed' || status.status === 'failed') {
      return status;
    }
    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed >= timeout) {
      return {
        success: true,
        status: 'processing',
        task_id: taskId,
        message: `Task is still processing (waited ${timeout} seconds). Please use get_task_status to continue polling.`,
        note: 'The synchronous wait for this long-running task has been truncated. Switch to get_task_status polling.',
      };
    }
    await sleep(pollInterval * 1000);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
