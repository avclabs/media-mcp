import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import FormData from 'form-data';

const Sam3PredictSchema = z.object({
  imagePath: z.string().optional().describe('Absolute path of a local image file (e.g. C:\\\\Users\\\\xxx\\\\photo.png)'),
  imageUrl: z.string().url().optional().describe('Publicly accessible URL of the image to process'),
  imageBase64: z.string().optional().describe('Base64-encoded image data. Use this when the image is provided as an attachment without a local path'),
  prompt: z.string().describe('Text prompt for mask generation. Must be in English. If the user provides Chinese or other non-English text, translate it to English before calling this tool'),
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

  server.tool(
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
    async (args) => {
      try {
        if (!apiKey) {
          throw new Error('SAM3 API Key not configured. Please set API_KEY environment variable or --api-key argument.');
        }
        const result = await sam3PredictTool(client, pollInterval, pollMaxAttempts, args);
        return {
          content: [{ type: 'text', text: result }],
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

async function getSam3PostSignature(client: AxiosInstance, fileName: string): Promise<any> {
  const response = await client.post('/get_postsignature_url', {
    file_type: 'image',
    file_name: fileName,
  });
  const data = response.data;
  if (data.code !== 0) {
    throw new Error(`get_postsignature_url error: ${data.message || 'unknown error'}`);
  }
  return data.data;
}

async function uploadImageToTos(url: string, sigData: any, tosKey: string, buffer: Buffer, fileName: string): Promise<void> {
  const formData = new FormData();
  formData.append('key', tosKey);
  formData.append('policy', sigData.policy);
  formData.append('x-tos-algorithm', sigData.algorithm);
  formData.append('x-tos-credential', sigData.credential);
  formData.append('x-tos-date', sigData.date);
  formData.append('x-tos-signature', sigData.signature);
  formData.append('file', buffer, fileName);

  const response = await axios.post(url, formData, {
    headers: formData.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  if (response.status >= 400) {
    throw new Error(`TOS upload failed: ${response.status} ${response.statusText}`);
  }
}

async function sam3Predict(client: AxiosInstance, fileId: string, prompt: string): Promise<string> {
  const response = await client.post('/predict', { file_id: fileId, prompt });
  return response.data.task_id;
}

async function downloadSam3Result(url: string): Promise<any> {
  const response = await axios.get(url);
  return response.data;
}

async function prepareImageBuffer(args: { imagePath?: string; imageUrl?: string; imageBase64?: string }): Promise<{ buffer: Buffer; fileName: string }> {
  const { imagePath, imageUrl, imageBase64 } = args;

  if (!imagePath && !imageUrl && !imageBase64) {
    throw new Error('Missing image input: must provide one of imagePath, imageUrl, or imageBase64');
  }

  let buffer: Buffer;
  let fileName: string;

  if (imagePath) {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Local file does not exist: ${imagePath}`);
    }
    fileName = path.basename(imagePath);
    buffer = fs.readFileSync(imagePath);
  } else if (imageUrl) {
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    buffer = Buffer.from(response.data);
    fileName = path.basename(new URL(imageUrl).pathname) || 'image.png';
  } else if (imageBase64) {
    buffer = Buffer.from(imageBase64, 'base64');
    fileName = 'image.png';
  } else {
    throw new Error('Missing image input: must provide one of imagePath, imageUrl, or imageBase64');
  }

  return { buffer, fileName };
}

async function sam3CreateTask(client: AxiosInstance, buffer: Buffer, fileName: string, prompt: string): Promise<string> {
  const signatureData = await getSam3PostSignature(client, fileName);
  const { url, origin_policy } = signatureData;

  if (!url) {
    throw new Error('Missing upload URL in post signature response');
  }

  const keyObj = JSON.parse(origin_policy).conditions.find((c: any) => 'key' in c);
  const tosKey = keyObj ? keyObj.key : new URL(url).pathname.slice(1);

  const fileId = new URL(url).pathname.split('/').pop();
  if (!fileId) {
    throw new Error('Could not extract file_id from upload URL');
  }

  await uploadImageToTos(url, signatureData, tosKey, buffer, fileName);
  const taskId = await sam3Predict(client, fileId, prompt);

  return taskId;
}

async function getSam3Result(client: AxiosInstance, taskId: string): Promise<any> {
  const response = await client.get(`/predict/result/${encodeURIComponent(taskId)}`);
  return response.data;
}

async function getSam3PredictResult(client: AxiosInstance, taskId: string, pollInterval: number, pollMaxAttempts: number): Promise<any> {
  for (let attempt = 0; attempt < pollMaxAttempts; attempt++) {
    const data = await getSam3Result(client, taskId);

    if (data.status === 'completed') {
      return data;
    }
    if (data.status === 'failed') {
      throw new Error(`Task failed: ${data.error_message || 'unknown error'}`);
    }
    await sleep(pollInterval);
  }
  return {
    success: true,
    status: 'processing',
    task_id: taskId,
    message: `Task is still processing (waited about ${Math.round(pollMaxAttempts * pollInterval / 1000)} seconds). Please retry later or record this task_id for manual follow-up.`,
    note: 'The synchronous wait for this long-running task has been truncated.',
  };
}

async function sam3PredictTool(
  client: AxiosInstance,
  pollInterval: number,
  pollMaxAttempts: number,
  args: z.infer<typeof Sam3PredictSchema>
): Promise<string> {
  if (!args.prompt) {
    throw new Error('Missing argument: prompt');
  }

  const { buffer, fileName } = await prepareImageBuffer(args);
  const taskId = await sam3CreateTask(client, buffer, fileName, args.prompt);

  const taskResult = await getSam3PredictResult(client, taskId, pollInterval, pollMaxAttempts);

  if (taskResult.success === true && taskResult.status === 'processing') {
    return JSON.stringify(taskResult, null, 2);
  }

  const resultUrl = taskResult.result;
  const resultJson = await downloadSam3Result(resultUrl);

  return JSON.stringify(resultJson, null, 2);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
