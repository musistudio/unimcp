import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  DEFAULT_MAX_LOCAL_IMAGE_BYTES,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_VISION_BASE_URL,
  DEFAULT_VISION_MODEL,
  compactRecord,
  env,
  envNumber
} from "./config.js";

export const imageInputSchema = z.object({
  url: z
    .string()
    .min(1)
    .optional()
    .describe("HTTP(S) URL or data URL for the image."),
  path: z
    .string()
    .min(1)
    .optional()
    .describe("Local filesystem path. Relative paths resolve from the MCP process cwd."),
  base64: z
    .string()
    .min(1)
    .optional()
    .describe("Raw base64 image data or a full data URL."),
  mimeType: z.string().min(1).optional().describe("Required when base64 is raw data."),
  label: z.string().min(1).optional().describe("Optional label used in the model prompt.")
});

const llmOptionsShape = {
  timeoutMs: z.number().int().positive().max(180_000).optional(),
  maxTokens: z.number().int().positive().max(16_384).optional(),
  temperature: z.number().min(0).max(2).optional(),
  responseFormat: z
    .enum(["text", "json_object"])
    .optional()
    .describe("Use json_object for OpenAI-compatible JSON mode.")
};

const imageOptionsShape = {
  images: z.array(imageInputSchema).min(1).max(8).optional(),
  imageUrl: z.string().min(1).optional().describe("Convenience field for one image URL."),
  imagePath: z.string().min(1).optional().describe("Convenience field for one local image path."),
  imageBase64: z.string().min(1).optional().describe("Convenience field for one raw base64 image."),
  mimeType: z.string().min(1).optional().describe("MIME type for imageBase64."),
  detail: z.enum(["auto", "low", "high"]).optional().describe("OpenAI image detail level."),
  systemPrompt: z.string().min(1).optional()
};

export const visionUnderstandInputSchema = z.object({
  prompt: z.string().min(1).describe("Question or instruction for the vision model."),
  ...imageOptionsShape,
  ...llmOptionsShape
});

export type VisionUnderstandInput = z.infer<typeof visionUnderstandInputSchema>;
export type ImageInput = z.infer<typeof imageInputSchema>;

export interface VisionResponse {
  text: string;
  model: string;
  endpoint: string;
  imageCount: number;
  usage?: unknown;
}

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

interface ResolvedImage {
  url: string;
  label?: string;
}

interface VisionRequest {
  prompt: string;
  images?: ImageInput[];
  imageUrl?: string;
  imagePath?: string;
  imageBase64?: string;
  mimeType?: string;
  detail?: "auto" | "low" | "high";
  systemPrompt?: string;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: "text" | "json_object";
}

export async function analyzeVision(input: VisionRequest): Promise<VisionResponse> {
  const config = resolveVisionConfig();
  const images = await resolveImages(collectImages(input));
  const userContent = buildVisionContent(input.prompt, images, input.detail);

  const messages = [
    ...(input.systemPrompt ? [{ role: "system", content: input.systemPrompt }] : []),
    { role: "user", content: userContent }
  ];

  const body = compactRecord({
    model: config.model,
    messages,
    temperature: input.temperature ?? 0.2,
    max_tokens: input.maxTokens ?? 1_200,
    response_format: input.responseFormat === "json_object" ? { type: "json_object" } : undefined
  });

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: compactRecord({
      "content-type": "application/json",
      authorization: config.apiKey ? `Bearer ${config.apiKey}` : undefined
    }) as HeadersInit,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(input.timeoutMs ?? envNumber("VISION_TIMEOUT_MS", DEFAULT_TIMEOUT_MS))
  });

  const rawText = await response.text();
  const json = parseJson(rawText, "vision LLM response");

  if (!response.ok) {
    throw new Error(`Vision LLM request failed (${response.status}): ${extractError(rawText, json)}`);
  }

  return {
    text: extractAssistantText(json),
    model: config.model,
    endpoint: redactEndpoint(config.endpoint),
    imageCount: images.length,
    usage: readProperty(json, "usage")
  };
}

function resolveVisionConfig(): { endpoint: string; apiKey?: string; model: string } {
  const baseUrl = env("VISION_BASE_URL") ?? env("OPENAI_BASE_URL") ?? DEFAULT_VISION_BASE_URL;
  const endpoint = chatCompletionsEndpoint(baseUrl);
  const apiKey = env("VISION_API_KEY") ?? env("OPENAI_API_KEY");
  const model = env("VISION_MODEL") ?? env("OPENAI_MODEL") ?? DEFAULT_VISION_MODEL;

  if (!apiKey && isOpenAiEndpoint(endpoint)) {
    throw new Error("Missing OpenAI API key. Set OPENAI_API_KEY or VISION_API_KEY.");
  }

  return { endpoint, apiKey, model };
}

function chatCompletionsEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }

  return `${trimmed}/chat/completions`;
}

function isOpenAiEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint).hostname === "api.openai.com";
  } catch {
    return false;
  }
}

function collectImages(input: VisionRequest): ImageInput[] {
  const images = [...(input.images ?? [])];
  const shortcut = [input.imageUrl, input.imagePath, input.imageBase64].filter(Boolean).length;

  if (shortcut > 1) {
    throw new Error("Use only one of imageUrl, imagePath, or imageBase64 for the convenience image input.");
  }

  if (input.imageUrl) {
    images.unshift({ url: input.imageUrl, label: "image" });
  }

  if (input.imagePath) {
    images.unshift({ path: input.imagePath, label: "image" });
  }

  if (input.imageBase64) {
    images.unshift({ base64: input.imageBase64, mimeType: input.mimeType, label: "image" });
  }

  if (images.length === 0) {
    throw new Error("Provide images[] or one of imageUrl, imagePath, or imageBase64.");
  }

  return images;
}

async function resolveImages(inputs: ImageInput[]): Promise<ResolvedImage[]> {
  return Promise.all(inputs.map(resolveImage));
}

async function resolveImage(input: ImageInput): Promise<ResolvedImage> {
  const sourceCount = [input.url, input.path, input.base64].filter(Boolean).length;
  if (sourceCount !== 1) {
    throw new Error("Each image must provide exactly one of url, path, or base64.");
  }

  if (input.url) {
    validateImageUrl(input.url);
    return { url: input.url, label: input.label };
  }

  if (input.base64) {
    return { url: toDataUrl(input.base64, input.mimeType), label: input.label };
  }

  if (!input.path) {
    throw new Error("Missing image path.");
  }

  const resolvedPath = path.isAbsolute(input.path) ? input.path : path.resolve(process.cwd(), input.path);
  const fileStat = await stat(resolvedPath);
  if (!fileStat.isFile()) {
    throw new Error(`Image path is not a file: ${resolvedPath}`);
  }

  const maxBytes = envNumber("VISION_MAX_LOCAL_IMAGE_BYTES", DEFAULT_MAX_LOCAL_IMAGE_BYTES);
  if (fileStat.size > maxBytes) {
    throw new Error(`Image file is too large: ${resolvedPath} (${fileStat.size} bytes, max ${maxBytes}).`);
  }

  const buffer = await readFile(resolvedPath);
  const mimeType = input.mimeType ?? mimeTypeFromPath(resolvedPath);
  return {
    url: `data:${mimeType};base64,${buffer.toString("base64")}`,
    label: input.label ?? path.basename(resolvedPath)
  };
}

function validateImageUrl(value: string): void {
  if (value.startsWith("data:")) {
    if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) {
      throw new Error("Image data URL must use an image/* MIME type and base64 encoding.");
    }
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid image URL: ${value}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported image URL protocol: ${parsed.protocol}`);
  }
}

function toDataUrl(value: string, mimeType?: string): string {
  if (value.startsWith("data:")) {
    validateImageUrl(value);
    return value;
  }

  return `data:${mimeType ?? "image/png"};base64,${value.replace(/\s/g, "")}`;
}

function mimeTypeFromPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".bmp":
      return "image/bmp";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    case ".png":
    default:
      return "image/png";
  }
}

function buildVisionContent(
  prompt: string,
  images: ResolvedImage[],
  detail: "auto" | "low" | "high" = "auto"
): ChatContentPart[] {
  const parts: ChatContentPart[] = [{ type: "text", text: prompt }];

  images.forEach((image, index) => {
    parts.push({ type: "text", text: `Image ${index + 1}${image.label ? ` (${image.label})` : ""}:` });
    parts.push({ type: "image_url", image_url: { url: image.url, detail } });
  });

  return parts;
}

function parseJson(rawText: string, label: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error(`Invalid JSON from ${label}: ${rawText.slice(0, 500)}`);
  }
}

function extractAssistantText(json: unknown): string {
  const choices = readProperty(json, "choices");
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("Vision LLM response did not include choices.");
  }

  const message = readProperty(choices[0], "message");
  const content = readProperty(message, "content");

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        const partText = readProperty(part, "text");
        return typeof partText === "string" ? partText : "";
      })
      .filter(Boolean)
      .join("\n");

    if (text) {
      return text;
    }
  }

  throw new Error("Vision LLM response did not include assistant text.");
}

function extractError(rawText: string, json: unknown): string {
  const error = readProperty(json, "error");
  const message = readProperty(error, "message");
  if (typeof message === "string") {
    return message;
  }

  return rawText.slice(0, 500);
}

function readProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
}

function redactEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return endpoint;
  }
}
