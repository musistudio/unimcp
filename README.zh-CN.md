# @musistudio/unimcp

[English](README.md) | 简体中文

`@musistudio/unimcp` 是一个基于 Node.js、TypeScript 和 esbuild 构建的 stdio MCP Server，提供统一的视觉理解和网络搜索工具。它适合接入支持 MCP 的客户端，用一个服务同时配置 OpenAI 兼容视觉模型和多个主流搜索 API。

## 功能

- `vision_understand`：通用图片理解工具，支持 OCR、截图分析、图表解读、UI 对比、错误诊断等多图任务。
- `web_search`：通用网络搜索工具，支持 Brave、Bing、Google CSE、Serper、SerpAPI、Tavily、Exa。
- 视觉模型使用 OpenAI 兼容的 `chat/completions` 接口，可配置自定义 base URL、模型和 API Key。
- 搜索服务支持自动选择已配置的 provider，也可以通过环境变量固定指定。

## 运行要求

- Node.js `>=22`
- 至少配置一个可用的视觉模型 API Key 或搜索 provider API Key，取决于你要使用的工具。

## 快速使用

无需全局安装，直接通过 `npx` 运行发布包：

```bash
npx @musistudio/unimcp
```

服务使用 stdio 与 MCP 客户端通信，因此通常不需要手动在终端里直接交互，而是写入 MCP 客户端配置。

## MCP 客户端配置

推荐在 MCP 客户端中使用 `npx` 加包名启动：

```json
{
  "mcpServers": {
    "unimcp": {
      "command": "npx",
      "args": ["-y", "@musistudio/unimcp"],
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "VISION_BASE_URL": "https://api.openai.com/v1",
        "VISION_MODEL": "gpt-4o-mini",
        "SEARCH_PROVIDER": "brave",
        "BRAVE_SEARCH_API_KEY": "..."
      }
    }
  }
}
```

如果只使用视觉理解工具，可以不配置搜索相关变量。如果只使用搜索工具，可以不配置视觉相关变量，直到调用 `vision_understand` 时才会要求视觉模型配置。

## 工具说明

### vision_understand

`vision_understand` 接收一个任务描述和一张或多张图片，调用 OpenAI 兼容视觉模型返回分析文本。

最小示例：

```json
{
  "prompt": "识别这张截图中的错误信息，并给出排查建议。",
  "imagePath": "/absolute/path/to/screenshot.png"
}
```

多图示例：

```json
{
  "prompt": "比较这两张截图的 UI 差异。",
  "images": [
    { "path": "/tmp/before.png", "label": "before" },
    { "path": "/tmp/after.png", "label": "after" }
  ]
}
```

支持的图片输入：

| 字段 | 说明 |
| --- | --- |
| `imageUrl` | 单张 HTTP(S) 图片 URL 或 data URL。 |
| `imagePath` | 单张本地图片路径；相对路径会基于 MCP 进程工作目录解析。 |
| `imageBase64` | 单张 raw base64 图片内容或完整 data URL。 |
| `images` | 多图数组，每项可使用 `url`、`path` 或 `base64`，并可附带 `mimeType`、`label`。 |

可选调用参数：

| 字段 | 说明 |
| --- | --- |
| `detail` | OpenAI 图片 detail 级别：`auto`、`low`、`high`。 |
| `systemPrompt` | 额外的 system prompt。 |
| `timeoutMs` | 本次视觉请求超时时间，覆盖 `VISION_TIMEOUT_MS`。 |
| `maxTokens` | 本次响应最大 token 数。 |
| `temperature` | 本次调用温度，范围 `0` 到 `2`。 |
| `responseFormat` | `text` 或 `json_object`。 |

### web_search

`web_search` 接收自然语言搜索需求，调用配置的搜索 provider 并返回归一化结果。

示例：

```json
{
  "prompt": "OpenAI Model Context Protocol latest SDK release",
  "count": 5,
  "language": "en",
  "freshness": "month"
}
```

可选调用参数：

| 字段 | 说明 |
| --- | --- |
| `count` | 返回结果数量，范围 `1` 到 `20`；默认读取 `SEARCH_RESULT_COUNT`。 |
| `country` | 国家或市场代码，具体含义由 provider 决定。 |
| `language` | 语言代码，具体含义由 provider 决定。 |
| `safeSearch` | 安全搜索级别：`off`、`moderate`、`strict`。 |
| `freshness` | 时间范围：`day`、`week`、`month`。 |
| `timeoutMs` | 本次搜索超时时间，覆盖 `SEARCH_TIMEOUT_MS`。 |
| `includeDomains` | 仅包含指定域名的结果。 |
| `excludeDomains` | 排除指定域名的结果。 |
| `includeRaw` | 是否在结构化结果中附带原始 provider 响应。 |

## 环境变量

### 视觉模型

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | 条件必填 | 无 | OpenAI API Key。`VISION_API_KEY` 未设置时作为视觉模型 API Key。调用 OpenAI 官方端点时必须设置 `OPENAI_API_KEY` 或 `VISION_API_KEY`。 |
| `VISION_API_KEY` | 条件必填 | 无 | 视觉模型专用 API Key，优先级高于 `OPENAI_API_KEY`。 |
| `VISION_BASE_URL` | 否 | `https://api.openai.com/v1` | 视觉模型 OpenAI 兼容 base URL，优先级高于 `OPENAI_BASE_URL`。可以直接配置到 `/chat/completions`，否则会自动追加。 |
| `OPENAI_BASE_URL` | 否 | 无 | 通用 OpenAI 兼容 base URL，`VISION_BASE_URL` 未设置时使用。 |
| `VISION_MODEL` | 否 | `gpt-4o-mini` | 视觉模型名称，优先级高于 `OPENAI_MODEL`。 |
| `OPENAI_MODEL` | 否 | 无 | 通用模型名称，`VISION_MODEL` 未设置时使用。 |
| `VISION_TIMEOUT_MS` | 否 | `30000` | 视觉模型请求超时时间，单位毫秒。 |
| `VISION_MAX_LOCAL_IMAGE_BYTES` | 否 | `20971520` | 单个本地图片文件最大字节数，默认 20 MiB。 |

### 搜索服务

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `SEARCH_PROVIDER` | 否 | `auto` | 搜索 provider。可选值：`auto`、`brave`、`bing`、`google_cse`、`serper`、`serpapi`、`tavily`、`exa`。`auto` 会按支持顺序选择第一个已配置 API Key 的 provider。 |
| `SEARCH_TIMEOUT_MS` | 否 | `30000` | 搜索请求超时时间，单位毫秒。 |
| `SEARCH_RESULT_COUNT` | 否 | `5` | 默认搜索结果数量，会被限制在 `1` 到 `20`。 |
| `BRAVE_SEARCH_API_KEY` | 条件必填 | 无 | Brave Search API Key。使用 `brave` 时必填。 |
| `BING_SEARCH_API_KEY` | 条件必填 | 无 | Bing Web Search API Key。使用 `bing` 时必填。 |
| `GOOGLE_SEARCH_API_KEY` | 条件必填 | 无 | Google Programmable Search API Key。使用 `google_cse` 时必填。 |
| `GOOGLE_SEARCH_CX` | 条件必填 | 无 | Google Programmable Search Engine ID。使用 `google_cse` 时必填。 |
| `SERPER_API_KEY` | 条件必填 | 无 | Serper API Key。使用 `serper` 时必填。 |
| `SERPAPI_API_KEY` | 条件必填 | 无 | SerpAPI API Key。使用 `serpapi` 时必填。 |
| `TAVILY_API_KEY` | 条件必填 | 无 | Tavily API Key。使用 `tavily` 时必填。 |
| `EXA_API_KEY` | 条件必填 | 无 | Exa API Key。使用 `exa` 时必填。 |
| `BRAVE_SEARCH_ENDPOINT` | 否 | `https://api.search.brave.com/res/v1/web/search` | Brave 自定义搜索端点。 |
| `BING_SEARCH_ENDPOINT` | 否 | `https://api.bing.microsoft.com/v7.0/search` | Bing 自定义搜索端点。 |
| `GOOGLE_SEARCH_ENDPOINT` | 否 | `https://www.googleapis.com/customsearch/v1` | Google CSE 自定义搜索端点。 |
| `SERPER_SEARCH_ENDPOINT` | 否 | `https://google.serper.dev/search` | Serper 自定义搜索端点。 |
| `SERPAPI_SEARCH_ENDPOINT` | 否 | `https://serpapi.com/search.json` | SerpAPI 自定义搜索端点。 |
| `TAVILY_SEARCH_ENDPOINT` | 否 | `https://api.tavily.com/search` | Tavily 自定义搜索端点。 |
| `EXA_SEARCH_ENDPOINT` | 否 | `https://api.exa.ai/search` | Exa 自定义搜索端点。 |

## 搜索 provider 配置示例

Brave：

```json
{
  "SEARCH_PROVIDER": "brave",
  "BRAVE_SEARCH_API_KEY": "..."
}
```

Google CSE：

```json
{
  "SEARCH_PROVIDER": "google_cse",
  "GOOGLE_SEARCH_API_KEY": "...",
  "GOOGLE_SEARCH_CX": "..."
}
```

Exa：

```json
{
  "SEARCH_PROVIDER": "exa",
  "EXA_API_KEY": "..."
}
```

自动选择 provider：

```json
{
  "SEARCH_PROVIDER": "auto",
  "BRAVE_SEARCH_API_KEY": "...",
  "TAVILY_API_KEY": "...",
  "EXA_API_KEY": "..."
}
```

`auto` 的选择顺序为 `brave`、`bing`、`google_cse`、`serper`、`serpapi`、`tavily`、`exa`。

## 本地开发

```bash
npm install
npm run build
npm start
```

本地开发时，也可以在 MCP 客户端中直接指向构建产物：

```json
{
  "mcpServers": {
    "unimcp-local": {
      "command": "node",
      "args": ["/absolute/path/to/unimcp/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

## 发布内容

npm 包会包含：

- `dist`
- `README.md`
- `README.zh-CN.md`
- `LICENSE`

## License

MIT
