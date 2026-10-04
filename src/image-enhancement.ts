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
import { POLL_REQUEST_TIMEOUT_MS, pollUntilTerminal, registerTool } from './tooling.js';

const PollIntervalSchema = z.number().min(0.5).max(30).default(5).describe('Polling interval in seconds (0.5-30), default 5');
const SyncTimeoutSchema = z.number().min(1).max(45).default(45).describe('Synchronous wait timeout in seconds (1-45), default 45. Returns task_id early when exceeded, use get_image_task_status to continue polling');

type ImageTaskType = 'enhance' | 'colorize' | 'denoise';

// Schemas
const EnhanceImageSyncSchema = z.object({
  image_source: z.string().describe('Image URL or local file path (URL must be publicly accessible, login or signed links are not supported)'),
  type: z.enum(['url', 'local']).default('url').describe('Upload type: url=remote image, local=local file'),
  scale: z.number().int().min(1).max(4).default(2).describe('Enhancement scale multiplier (1-4), default 2. Controls the upscaling factor for image enhancement (e.g. 2=2x, 4=4x)'),
  poll_interval: PollIntervalSchema,
  timeout: SyncTimeoutSchema,
});

const ColorizeImageSyncSchema = z.object({
  image_source: z.string().describe('Image URL or local file path (URL must be publicly accessible, login or signed links are not supported)'),
  type: z.enum(['url', 'local']).default('url').describe('Upload type: url=remote image, local=local file'),
  poll_interval: PollIntervalSchema,
  timeout: SyncTimeoutSchema,
});

const DenoiseImageSyncSchema = z.object({
  image_source: z.string().describe('Image URL or local file path (URL must be publicly accessible, login or signed links are not supported)'),
  type: z.enum(['url', 'local']).default('url').describe('Upload type: url=remote image, local=local file'),
  poll_interval: PollIntervalSchema,
  timeout: SyncTimeoutSchema,
});

// Schema - status query
const GetImageTaskStatusSchema = z.object({
  task_id: z.string().describe('Task ID'),
});

export function setupImageEnhancementTools(server: McpServer, baseUrl: string, apiKey: string): void {
  const client: AxiosInstance = axios.create({
    baseURL: baseUrl.replace(/\/$/, ''),
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  });

  // ========== Sync task tools ==========

  registerTool(
    server,
    'enhance_image_sync',
    `Enhance/upscale an image to improve quality (图片增强/放大/超分辨率). Use this tool ONLY for image enhancement and upscaling tasks.

Two upload methods are supported:
1. URL upload: provide an image URL
2. Local upload: provide a local file path, the MCP Server will auto-upload to TOS object storage

Best for images with estimated processing time < 1 minute. If the task is not completed within the timeout, the tool returns early with a task_id. Use get_image_task_status to continue polling.`,
    EnhanceImageSyncSchema.shape,
    async (args) => processImageSync(client, args.image_source, args.type, 'enhance', args.poll_interval, args.timeout, args.scale)
  );

  registerTool(
    server,
    'colorize_image_sync',
    `Colorize a black-and-white photo (黑白照片上色/旧照片上色). Use this tool ONLY for adding color to grayscale or black-and-white images.

Two upload methods are supported:
1. URL upload: provide an image URL
2. Local upload: provide a local file path, the MCP Server will auto-upload to TOS object storage

Best for images with estimated processing time < 1 minute. If the task is not completed within the timeout, the tool returns early with a task_id. Use get_image_task_status to continue polling.`,
    ColorizeImageSyncSchema.shape,
    async (args) => processImageSync(client, args.image_source, args.type, 'colorize', args.poll_interval, args.timeout)
  );

  registerTool(
    server,
    'denoise_image_sync',
    `Remove noise from an image (图片降噪/去噪). Use this tool ONLY for denoising noisy or grainy images.

Two upload methods are supported:
1. URL upload: provide an image URL
2. Local upload: provide a local file path, the MCP Server will auto-upload to TOS object storage

Best for images with estimated processing time < 1 minute. If the task is not completed within the timeout, the tool returns early with a task_id. Use get_image_task_status to continue polling.`,
    DenoiseImageSyncSchema.shape,
    async (args) => processImageSync(client, args.image_source, args.type, 'denoise', args.poll_interval, args.timeout)
  );

  // ========== Status query tool ==========

  registerTool(
    server,
    'get_image_task_status',
    'Query image processing task status. The status field can be: processing, completed, or failed. If status is processing, wait a few seconds and call this tool again to poll.',
    GetImageTaskStatusSchema.shape,
    async (args) => {
      const result = await getImageTaskStatus(client, args.task_id);
      return {
        ...result,
        message: result.status === 'processing' ? 'Task is still processing, please check again later' : undefined,
      };
    }
  );
}

async function getImageTosSignature(client: AxiosInstance, fileName: string): Promise<any> {
  const response = await client.post('/api/v3/contents/generations/tos-signature', {
    file_type: 'image',
    file_name: fileName,
  });
  const unwrapped = unwrapEnvelope(response);
  if (!unwrapped.ok) {
    throw new Error(unwrapped.error);
  }
  return unwrapped.data;
}

function getEndpointByTaskType(taskType: ImageTaskType): string {
  switch (taskType) {
    case 'enhance':
      return '/api/v3/contents/generations/image/enhance';
    case 'colorize':
      return '/api/v3/contents/generations/image/colorize';
    case 'denoise':
      return '/api/v3/contents/generations/image/denoise';
  }
}

function getModelByTaskType(taskType: ImageTaskType): string {
  switch (taskType) {
    case 'enhance':
      return 'avc-image-enhance';
    case 'colorize':
      return 'avc-image-colorize';
    case 'denoise':
      return 'avc-image-denoise';
  }
}

async function createImageTask(
  client: AxiosInstance,
  imageSource: string,
  sourceType: 'url' | 'local',
  taskType: ImageTaskType,
  scale?: number
): Promise<any> {
  let contentItem: any;

  if (sourceType === 'local') {
    const fileInfo = checkLocalFile(imageSource, 'image');

    // Step 1: Get TOS signature
    let target;
    try {
      target = parseTosSignature(await getImageTosSignature(client, fileInfo.fileName));
    } catch (error: any) {
      throw new Error(`[Step 1: TOS signature failed] ${formatRequestError(error)}`);
    }

    // Step 2: Upload to TOS
    try {
      await uploadToTos(target, fs.createReadStream(imageSource), fileInfo.fileName);
    } catch (error: any) {
      throw new Error(`[Step 2: TOS upload failed] ${error.message}`);
    }

    contentItem = { type: 'image_file', file_id: target.fileId, file_name: fileInfo.fileName };
  } else {
    contentItem = { type: 'image_url', image_url: { url: imageSource } };
  }

  // Step 3: Call image API
  const endpoint = getEndpointByTaskType(taskType);
  const payload: any = { model: getModelByTaskType(taskType), content: [contentItem] };
  if (scale !== undefined) {
    payload.scale = scale;
  }
  let response;
  try {
    response = await client.post(endpoint, payload);
  } catch (error: any) {
    throw new Error(`[Step 3: API call failed] endpoint=${endpoint} ${formatRequestError(error)}`);
  }
  const unwrapped = unwrapEnvelope(response);
  if (!unwrapped.ok) {
    return { success: false, error: unwrapped.error };
  }
  return { success: true, task_id: unwrapped.data.task_id, status: unwrapped.data.status };
}

async function getImageTaskStatus(client: AxiosInstance, taskId: string, signal?: AbortSignal): Promise<any> {
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
    image_url: result.image_url,
    error_message: result.error_message,
    created_at: result.created_at,
    updated_at: result.updated_at,
  };
}

async function processImageSync(
  client: AxiosInstance,
  imageSource: string,
  sourceType: 'url' | 'local',
  taskType: ImageTaskType,
  pollInterval: number,
  timeout: number,
  scale?: number
): Promise<any> {
  const createResult = await createImageTask(client, imageSource, sourceType, taskType, scale);
  if (!createResult.success) {
    return createResult;
  }

  return pollUntilTerminal({
    taskId: createResult.task_id,
    timeoutSeconds: timeout,
    pollIntervalSeconds: pollInterval,
    continueHint: 'get_image_task_status',
    fetchStatus: async (signal) => {
      const { task_id, status, ...payload } = await getImageTaskStatus(client, createResult.task_id, signal);
      return { status, payload };
    },
  });
}
