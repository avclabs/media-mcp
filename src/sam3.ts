import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import {
  checkLocalFile,
  decodeBase64Image,
  downloadToBuffer,
  parseTosSignature,
  unwrapEnvelope,
  uploadToTos,
} from './tos.js';
import { classifyStatus, POLL_REQUEST_TIMEOUT_MS, pollUntilTerminal, registerTool } from './tooling.js';

const SAM3_SUCCESS_CODES = new Set([0]);

const Sam3PredictSchema = z.object({
  imagePath: z.string().optional().describe('Absolute path of a local image file (e.g. C:\\\\Users\\\\xxx\\\\photo.png)'),
  imageUrl: z.string().url().optional().describe('Publicly accessible URL of the image to process'),
  imageBase64: z.string().optional().describe('Base64-encoded image data (a data: URL prefix is also accepted). Use this when the image is provided as an attachment without a local path'),
  prompt: z.string().min(1).max(500).describe('Text prompt for mask generation. Must be in English. If the user provides Chinese or other non-English text, translate it to English before calling this tool'),
});

const GetSam3TaskStatusSchema = z.object({
  task_id: z.string().describe('SAM3 task ID returned by sam3_predict'),
});

export function setupSam3Tools(
  server: McpServer,
  baseUrl: string,
  apiKey: string,
  pollInterval: number,
  pollMaxAttempts: number
): void {
  const client: AxiosInstance = axios.create({
    baseURL: baseUrl.replace(/\/$/, ''),
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  });

  registerTool(
    server,
    'sam3_predict',
    `Analyze an image using the SAM3 segmentation API to generate inference results (masks, boxes, scores).
The image can be provided in one of three ways:
1. imagePath: Absolute path of a local image file (e.g. C:\\Users\\xxx\\photo.png). Use this when the user provides a local file path.
2. imageUrl: Publicly accessible URL of the image (e.g. https://example.com/photo.jpg). Use this when the user provides a web link.
3. imageBase64: Base64-encoded image data. Use this when the user uploads or drags-and-drops an image as an attachment and no local path is available.
In this case, encode the image content as base64 and pass it via this parameter.
If the user mentions an uploaded image but does not provide a path, URL, or base64 data, ask the user for the local absolute path.
Prompt must be in English. If the user provides Chinese or other non-English text, translate it to English before calling this tool.`,
    Sam3PredictSchema.shape,
    async (args) => sam3PredictTool(client, pollInterval, pollMaxAttempts, args)
  );

  registerTool(
    server,
    'get_sam3_task_status',
    'Query SAM3 image segmentation task status by task_id. Status can be: processing, completed, or failed. If completed, the result URL is returned.',
    GetSam3TaskStatusSchema.shape,
    async (args) => {
      const data = await getSam3Result(client, args.task_id);
      return normalizeSam3Status(args.task_id, data);
    }
  );
}

function normalizeSam3Status(taskId: string, data: any): Record<string, any> {
  const kind = classifyStatus(data?.status);
  if (kind === 'ok') {
    return {
      success: true,
      task_id: taskId,
      status: data.status,
      result_url: data.result,
    };
  }
  if (kind === 'failed') {
    return {
      success: false,
      task_id: taskId,
      status: data.status,
      error: data.error_message || 'Task failed',
    };
  }
  if (kind === 'unknown') {
    return {
      success: false,
      task_id: taskId,
      status: data?.status ?? 'unknown',
      error: `Unrecognized task status: ${JSON.stringify(data?.status ?? null)}`,
    };
  }
  return {
    success: true,
    task_id: taskId,
    status: data.status,
    message: 'Task is still processing, please check again later.',
  };
}

async function getSam3PostSignature(client: AxiosInstance, fileName: string): Promise<any> {
  const response = await client.post('/get_postsignature_url', {
    file_type: 'image',
    file_name: fileName,
  });
  const unwrapped = unwrapEnvelope(response, SAM3_SUCCESS_CODES);
  if (!unwrapped.ok) {
    throw new Error(`get_postsignature_url error: ${unwrapped.error}`);
  }
  return unwrapped.data;
}

async function sam3Predict(client: AxiosInstance, fileId: string, prompt: string): Promise<string> {
  const response = await client.post('/predict', { file_id: fileId, prompt });
  const body = response.data;
  if (!body || typeof body !== 'object' || typeof body.task_id !== 'string' || !body.task_id) {
    const preview = typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body)?.slice(0, 200);
    throw new Error(`Unexpected /predict response: ${preview}`);
  }
  return body.task_id;
}

async function downloadSam3Result(url: string): Promise<any> {
  const response = await axios.get(url, { timeout: 30000 });
  return response.data;
}

async function prepareImageBuffer(args: { imagePath?: string; imageUrl?: string; imageBase64?: string }): Promise<{ buffer: Buffer; fileName: string }> {
  const { imagePath, imageUrl, imageBase64 } = args;

  if (imagePath) {
    checkLocalFile(imagePath, 'image');
    return { buffer: fs.readFileSync(imagePath), fileName: path.basename(imagePath) };
  }
  if (imageUrl) {
    const buffer = await downloadToBuffer(imageUrl);
    const fileName = path.basename(new URL(imageUrl).pathname) || 'image.png';
    return { buffer, fileName };
  }
  if (imageBase64) {
    return decodeBase64Image(imageBase64);
  }
  throw new Error('Missing image input: must provide one of imagePath, imageUrl, or imageBase64');
}

async function sam3CreateTask(client: AxiosInstance, buffer: Buffer, fileName: string, prompt: string): Promise<string> {
  const signatureData = await getSam3PostSignature(client, fileName);
  const target = parseTosSignature(signatureData);

  await uploadToTos(target, buffer, fileName);
  return sam3Predict(client, target.fileId, prompt);
}

async function getSam3Result(client: AxiosInstance, taskId: string): Promise<any> {
  const response = await client.get(`/predict/result/${encodeURIComponent(taskId)}`, {
    timeout: POLL_REQUEST_TIMEOUT_MS,
  });
  const data = response.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Unexpected task status response (HTTP ${response.status})`);
  }
  return data;
}

async function sam3PredictTool(
  client: AxiosInstance,
  pollInterval: number,
  pollMaxAttempts: number,
  args: z.infer<typeof Sam3PredictSchema>
): Promise<unknown> {
  const { buffer, fileName } = await prepareImageBuffer(args);
  const taskId = await sam3CreateTask(client, buffer, fileName, args.prompt);

  const taskResult = await pollUntilTerminal({
    taskId,
    timeoutSeconds: (pollInterval * pollMaxAttempts) / 1000,
    pollIntervalSeconds: pollInterval / 1000,
    continueHint: 'get_sam3_task_status',
    fetchStatus: async () => {
      const data = await getSam3Result(client, taskId);
      return {
        status: data.status,
        payload: { result_url: data.result, error_message: data.error_message },
      };
    },
  });

  if (!taskResult.success || taskResult.status === 'processing') {
    return taskResult;
  }

  const resultJson = await downloadSam3Result(taskResult.result_url);
  return JSON.stringify(resultJson, null, 2);
}
