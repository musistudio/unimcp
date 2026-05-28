# @musistudio/unimcp

English | [Simplified Chinese](README.zh-CN.md)

`@musistudio/unimcp` is a stdio MCP server built with Node.js, TypeScript, and esbuild. It provides unified vision understanding and web search tools for MCP clients, with OpenAI-compatible vision model configuration and multiple search API providers.

## Features

- `vision_understand`: generic image understanding for OCR, screenshot analysis, chart reading, UI comparison, error diagnosis, and other multi-image tasks.
- `web_search`: generic web search with Brave, Bing, Google CSE, Serper, SerpAPI, and Tavily.
- Vision calls use an OpenAI-compatible `chat/completions` endpoint, with configurable base URL, model, and API key.
- Search can automatically select the first configured provider, or use a provider explicitly selected by environment variable.

## Requirements

- Node.js `>=22`
- Configure at least one vision model API key or search provider API key, depending on which tools you use.

## Quick Start

Run the published package directly with `npx`:

```bash
npx @musistudio/unimcp
```

The server communicates over stdio, so it is usually started by an MCP client rather than used interactively in a terminal.

## MCP Client Configuration

Use `npx` with the package name in your MCP client config:

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

If you only use the vision tool, search variables are not required. If you only use the search tool, vision variables are not required until `vision_understand` is called.

## Tools

### vision_understand

`vision_understand` takes an instruction and one or more images, then returns analysis from an OpenAI-compatible vision model.

Minimal example:

```json
{
  "prompt": "Read the error message in this screenshot and suggest debugging steps.",
  "imagePath": "/absolute/path/to/screenshot.png"
}
```

Multi-image example:

```json
{
  "prompt": "Compare the UI differences between these screenshots.",
  "images": [
    { "path": "/tmp/before.png", "label": "before" },
    { "path": "/tmp/after.png", "label": "after" }
  ]
}
```

Image inputs:

| Field | Description |
| --- | --- |
| `imageUrl` | Single HTTP(S) image URL or data URL. |
| `imagePath` | Single local image path. Relative paths resolve from the MCP process working directory. |
| `imageBase64` | Single raw base64 image payload or full data URL. |
| `images` | Multi-image array. Each item can use `url`, `path`, or `base64`, with optional `mimeType` and `label`. |

Optional call parameters:

| Field | Description |
| --- | --- |
| `detail` | OpenAI image detail level: `auto`, `low`, or `high`. |
| `systemPrompt` | Additional system prompt. |
| `timeoutMs` | Request timeout for this vision call. Overrides `VISION_TIMEOUT_MS`. |
| `maxTokens` | Maximum response tokens for this call. |
| `temperature` | Temperature for this call, from `0` to `2`. |
| `responseFormat` | `text` or `json_object`. |

### web_search

`web_search` takes a natural-language search request, calls the configured search provider, and returns normalized results.

Example:

```json
{
  "prompt": "OpenAI Model Context Protocol latest SDK release",
  "count": 5,
  "language": "en",
  "freshness": "month"
}
```

Optional call parameters:

| Field | Description |
| --- | --- |
| `count` | Number of results, from `1` to `20`. Defaults to `SEARCH_RESULT_COUNT`. |
| `country` | Country or market code. Provider-specific. |
| `language` | Language code. Provider-specific. |
| `safeSearch` | Safe search level: `off`, `moderate`, or `strict`. |
| `freshness` | Time range: `day`, `week`, or `month`. |
| `timeoutMs` | Request timeout for this search call. Overrides `SEARCH_TIMEOUT_MS`. |
| `includeDomains` | Restrict results to these domains. |
| `excludeDomains` | Exclude these domains from results. |
| `includeRaw` | Include the raw provider response in structured output. |

## Environment Variables

### Vision Model

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | Conditional | None | OpenAI API key. Used as the vision model API key when `VISION_API_KEY` is not set. Required for OpenAI official endpoints unless `VISION_API_KEY` is set. |
| `VISION_API_KEY` | Conditional | None | Vision-specific API key. Takes precedence over `OPENAI_API_KEY`. |
| `VISION_BASE_URL` | No | `https://api.openai.com/v1` | OpenAI-compatible vision base URL. Takes precedence over `OPENAI_BASE_URL`. It can point directly to `/chat/completions`; otherwise that path is appended automatically. |
| `OPENAI_BASE_URL` | No | None | Generic OpenAI-compatible base URL, used when `VISION_BASE_URL` is not set. |
| `VISION_MODEL` | No | `gpt-4o-mini` | Vision model name. Takes precedence over `OPENAI_MODEL`. |
| `OPENAI_MODEL` | No | None | Generic model name, used when `VISION_MODEL` is not set. |
| `VISION_TIMEOUT_MS` | No | `30000` | Vision request timeout in milliseconds. |
| `VISION_MAX_LOCAL_IMAGE_BYTES` | No | `20971520` | Maximum size for each local image file in bytes. Default is 20 MiB. |

### Search

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SEARCH_PROVIDER` | No | `auto` | Search provider. Supported values: `auto`, `brave`, `bing`, `google_cse`, `serper`, `serpapi`, `tavily`. `auto` selects the first provider with a valid API key in the supported order. |
| `SEARCH_TIMEOUT_MS` | No | `30000` | Search request timeout in milliseconds. |
| `SEARCH_RESULT_COUNT` | No | `5` | Default result count, clamped from `1` to `20`. |
| `BRAVE_SEARCH_API_KEY` | Conditional | None | Brave Search API key. Required for `brave`. |
| `BING_SEARCH_API_KEY` | Conditional | None | Bing Web Search API key. Required for `bing`. |
| `GOOGLE_SEARCH_API_KEY` | Conditional | None | Google Programmable Search API key. Required for `google_cse`. |
| `GOOGLE_SEARCH_CX` | Conditional | None | Google Programmable Search Engine ID. Required for `google_cse`. |
| `SERPER_API_KEY` | Conditional | None | Serper API key. Required for `serper`. |
| `SERPAPI_API_KEY` | Conditional | None | SerpAPI API key. Required for `serpapi`. |
| `TAVILY_API_KEY` | Conditional | None | Tavily API key. Required for `tavily`. |
| `BRAVE_SEARCH_ENDPOINT` | No | `https://api.search.brave.com/res/v1/web/search` | Custom Brave search endpoint. |
| `BING_SEARCH_ENDPOINT` | No | `https://api.bing.microsoft.com/v7.0/search` | Custom Bing search endpoint. |
| `GOOGLE_SEARCH_ENDPOINT` | No | `https://www.googleapis.com/customsearch/v1` | Custom Google CSE endpoint. |
| `SERPER_SEARCH_ENDPOINT` | No | `https://google.serper.dev/search` | Custom Serper endpoint. |
| `SERPAPI_SEARCH_ENDPOINT` | No | `https://serpapi.com/search.json` | Custom SerpAPI endpoint. |
| `TAVILY_SEARCH_ENDPOINT` | No | `https://api.tavily.com/search` | Custom Tavily endpoint. |

## Search Provider Examples

Brave:

```json
{
  "SEARCH_PROVIDER": "brave",
  "BRAVE_SEARCH_API_KEY": "..."
}
```

Google CSE:

```json
{
  "SEARCH_PROVIDER": "google_cse",
  "GOOGLE_SEARCH_API_KEY": "...",
  "GOOGLE_SEARCH_CX": "..."
}
```

Automatic provider selection:

```json
{
  "SEARCH_PROVIDER": "auto",
  "BRAVE_SEARCH_API_KEY": "...",
  "TAVILY_API_KEY": "..."
}
```

The `auto` provider order is `brave`, `bing`, `google_cse`, `serper`, `serpapi`, `tavily`.

## Local Development

```bash
npm install
npm run build
npm start
```

For local development, you can also point your MCP client directly to the built output:

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

## Published Files

The npm package includes:

- `dist`
- `README.md`
- `README.zh-CN.md`
- `LICENSE`

## License

MIT
