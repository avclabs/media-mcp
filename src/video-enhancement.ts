import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import FormData from 'form-data';

// Schemas
const CreateTaskSchema = z.object({
  video_source: z.string().describe('视频URL地址或本地文件路径（URL必须公网可访问，不支持需要登录或签名的链接）'),
  type: z.enum(['url', 'local']).default('url').describe('上传类型：url=网络视频，local=本地文件'),
  resolution: z.enum(['480p', '540p', '720p', '1080p', '2k']).default('720p').describe('目标分辨率，默认720p'),
});

const GetTaskStatusSchema = z.object({
  task_id: z.string().describe('任务ID'),
});

const EnhanceVideoSyncSchema = z.object({
  video_source: z.string().describe('视频URL地址或本地文件路径（URL必须公网可访问，不支持需要登录或签名的链接）'),
  type: z.enum(['url', 'local']).default('url').describe('上传类型：url=网络视频，local=本地文件'),
  resolution: z.enum(['480p', '540p', '720p', '1080p', '2k']).default('720p').describe('目标分辨率，默认720p'),
  poll_interval: z.number().default(5).describe('轮询间隔（秒），默认5'),
  timeout: z.number().default(50).describe('同步等待的超时时间（秒），默认50。超过后工具会主动返回 task_id，请使用 get_task_status 继续查询'),
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
    `创建视频增强任务（异步）

支持两种上传方式：
1. URL 上传：提供视频 URL
2. 本地上传：提供本地文件路径，MCP Server 自动上传到 TOS 对象存储

参数说明：
- video_source: 视频 URL 或本地文件路径
- type: "url" 或 "local"
- resolution: 目标分辨率

创建任务后会立即返回 task_id。你需要使用 get_task_status 工具轮询查询任务结果，直到 status 变为 "completed" 或 "failed"。`,
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
    '查询视频增强任务状态。返回值中的 status 字段可能为：processing（处理中）、completed（已完成）、failed（失败）。如果 status 为 processing，你需要等待几秒后再次调用此工具轮询。',
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
    `同步增强视频（阻塞等待完成）

支持两种上传方式：
1. URL 上传：提供视频 URL
2. 本地上传：提供本地文件路径，MCP Server 自动上传到 TOS 对象存储

参数说明：
- video_source: 视频 URL 或本地文件路径
- type: "url" 或 "local"
- resolution: 目标分辨率
- poll_interval: 轮询间隔（秒）
- timeout: 同步等待的超时时间（秒），默认50

此工具仅适合短视频（预计处理时间 < 1 分钟）。如果任务在 50 秒内未完成，工具会提前返回并包含 task_id，你需要使用 get_task_status 继续查询。`,
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
    throw new Error(`文件不存在: ${filePath}`);
  }
  const stats = fs.statSync(filePath);
  const maxSize = 100 * 1024 * 1024;
  if (stats.size > maxSize) {
    throw new Error('文件大小超过 100MB 限制');
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
    throw new Error(data.message || '获取 TOS 签名失败');
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
    throw new Error(`TOS 上传失败: ${response.status} ${response.statusText}\n调试信息: ${debugInfo}`);
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
    message: result.status === 'processing' ? '任务仍在处理中，请稍后再查询' : undefined,
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
        message: `任务仍在处理中（已等待 ${timeout} 秒）。请使用 get_task_status 工具继续查询此任务状态。`,
        note: '此工具对长任务的同步等待已被截断，请切换到 get_task_status 轮询模式。',
      };
    }
    await sleep(pollInterval * 1000);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
