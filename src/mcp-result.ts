import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function textResult(text: string, structuredContent?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structuredContent ? { structuredContent } : {})
  };
}

export function errorResult(error: unknown): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: errorMessage(error) }]
  };
}

export async function asToolResult(operation: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await operation();
  } catch (error) {
    return errorResult(error);
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}
