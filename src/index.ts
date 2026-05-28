import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { asToolResult, textResult } from "./mcp-result.js";
import { analyzeVision, visionUnderstandInputSchema } from "./vision.js";
import { formatSearchResults, webSearch, webSearchInputSchema } from "./search.js";

const server = new McpServer({
  name: "unimcp",
  version: "1.0.0"
});

server.registerTool(
  "vision_understand",
  {
    title: "Vision Understand",
    description:
      "通用图片理解工具。用 prompt 描述具体需求，支持 images 多图数组，并兼容 OpenAI chat/completions 格式的自定义视觉 LLM。",
    inputSchema: visionUnderstandInputSchema
  },
  async (input) =>
    asToolResult(async () => {
      const response = await analyzeVision(input);
      return textResult(response.text, {
        model: response.model,
        endpoint: response.endpoint,
        imageCount: response.imageCount,
        usage: response.usage
      });
    })
);

server.registerTool(
  "web_search",
  {
    title: "Web Search",
    description:
      "通用网络搜索工具。用 prompt 描述搜索需求，支持 Brave、Bing、Google CSE、Serper、SerpAPI、Tavily 等主流搜索 API。",
    inputSchema: webSearchInputSchema
  },
  async (input) =>
    asToolResult(async () => {
      const response = await webSearch(input);
      return textResult(formatSearchResults(response), {
        provider: response.provider,
        prompt: response.prompt,
        results: response.results,
        raw: response.raw
      });
    })
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
