import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-app-boot";
import { clientRequestSchema, type ConnectionRpcHandlerResult } from "@deepseek-ai/dsh-client-connection";
import { createMcpToolDefinition } from "@deepseek-ai/dsh-mcp-client";
import type {} from "@deepseek-ai/dsh-tools";
import schema from "@deepseek-ai/schemastery";
import { Client, type CallToolResult, type Tool } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { join } from "node:path";
import { toolNameForPath } from "../src/router.js";
import { CHANNEL, RESOURCE, CALL_TOOL, appPath, resourceCsp, toolCall } from "./protocol.js";

export const name = "scraper";
export const inject = ["connection", "profileContext", "tools"];

export const Config = schema.object({
  toolTimeoutMs: schema.number().step(1).min(1_000).max(1_800_000).default(600_000),
});

interface ToolUi {
  resourceUri?: string;
  visibility?: string[];
}

function uiMetadata(tool: Tool): ToolUi {
  return (tool._meta?.ui ?? {}) as ToolUi;
}

function dshToolName(name: string): string {
  return `scraper_${name.replaceAll(".", "_")}`;
}

const openSidebar = "请从右侧栏的「开始」打开「数据采集」，再选择所需平台和页面。";

function dshResult(result: CallToolResult, fromSidebar: boolean): CallToolResult {
  const value = result.structuredContent;
  const structured = typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
  if (!fromSidebar && structured?.kind === "page") {
    return { ...result, content: [{ type: "text", text: openSidebar }] };
  }
  if (result.isError) {
    const loginHint = (text: string) => text
      .replace("请先调用 xiaohongshu.get_cookie（宿主工具名：mcp.scraper.xiaohongshu.get_cookie）",
        fromSidebar ? "请在采集页面中选择小红书登录" : `请先调用 ${dshToolName("xiaohongshu.get_cookie")}`)
      .replace("请先调用 get_cookie 完成登录",
        fromSidebar ? "请在采集页面中选择抖音登录" : `请先调用 ${dshToolName("douyin.get_cookie")} 完成登录`);
    const error = structured?.error;
    return {
      ...result,
      content: result.content.map(item => item.type === "text" ? { ...item, text: loginHint(item.text) } : item),
      ...(typeof error === "string" ? { structuredContent: { ...structured, error: loginHint(error) } } : {}),
    };
  }
  if (!fromSidebar && typeof structured?.exportId === "string") {
    return {
      ...result,
      content: result.content.map(item => item.type === "text"
        ? { ...item, text: item.text.replaceAll("state.get_export", dshToolName("state.get_export")) }
        : item),
    };
  }
  return result;
}

export async function apply(ctx: Context, config: { toolTimeoutMs: number }): Promise<void> {
  const env = Object.fromEntries(Object.entries(process.env).flatMap(([key, value]) =>
    key.startsWith("DOUYIN_") && value !== undefined ? [[key, value]] : [],
  ));
  env.DOUYIN_DATA_DIR ||= join(ctx.profileContext.dir, "data", "scraper");
  const child = new StdioClientTransport({
    // Desktop's Host can run under Electron. better-sqlite3 is installed for Node.
    command: process.versions.electron ? "node" : process.execPath,
    args: [join(import.meta.dirname, "main.js"), "--stdio", "--ui"],
    cwd: import.meta.dirname,
    env,
  });
  const mcp = new Client({ name: "DSH scraper", version: "0.1.0" });
  const lifetime = new AbortController();
  ctx.effect(() => async () => {
    lifetime.abort();
    await mcp.close();
  });

  const timeout = config.toolTimeoutMs;
  await mcp.connect(child, { signal: lifetime.signal });
  const { tools } = await mcp.listTools(undefined, { signal: lifetime.signal });
  const toolByName = new Map(tools.map(tool => [tool.name, tool]));

  for (const tool of tools) {
    if (uiMetadata(tool).visibility?.includes("model") === false) continue;
    ctx.effect(() => ctx.tools.register(createMcpToolDefinition(ctx, {
      name: dshToolName(tool.name),
      rawName: tool.name,
      description: (tool.description ?? "")
        .replace(/省略时只打开[^；。]+/g, "省略时返回侧栏入口")
        .replaceAll("state.get_export", dshToolName("state.get_export")),
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      async call(args, execution) {
        const result = await mcp.callTool(
          { name: tool.name, arguments: args },
          { signal: AbortSignal.any([lifetime.signal, execution.signal]), timeout, toolDefinition: tool },
        );
        return dshResult(result, false);
      },
    })));
  }

  async function readApp(payload: unknown, signal: AbortSignal) {
    const tool = toolByName.get(toolNameForPath(appPath.parse(payload)));
    const uri = tool && uiMetadata(tool).resourceUri;
    if (!uri?.startsWith("ui://scraper/") || !tool) throw new Error("采集页面未注册");
    const resource = await mcp.readResource({ uri }, { signal });
    const content = resource.contents.find(item => item.uri === uri && item.mimeType === RESOURCE_MIME_TYPE);
    if (!content || !("text" in content)) throw new Error("采集页面资源缺失，请重新构建插件");
    const ui = content._meta?.ui as { csp?: unknown } | undefined;
    return { html: content.text, tool, csp: resourceCsp.parse(ui?.csp ?? {}) };
  }

  async function callAppTool(payload: unknown, signal: AbortSignal) {
    const params = toolCall.parse(payload);
    const tool = toolByName.get(params.name);
    if (!tool || uiMetadata(tool).visibility?.includes("app") === false) {
      throw new Error("采集页面无权调用此工具");
    }
    return dshResult(await mcp.callTool(params, { signal, timeout, toolDefinition: tool }), true);
  }

  for (const [method, handler] of [[RESOURCE, readApp], [CALL_TOOL, callAppTool]] as const) {
    ctx.effect(() => ctx.connection.fetch.register({
      path: `${CHANNEL}/${method}`,
      methods: ["POST"],
      requestBody: "buffered",
      async fetch(request) {
        if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
          return new Response("Expected application/json", { status: 415 });
        }
        const input = clientRequestSchema.safeParse(await request.json().catch(() => null));
        if (!input.success || input.data.method !== method) return new Response("Invalid RPC request", { status: 400 });
        let result: ConnectionRpcHandlerResult;
        try {
          const signal = AbortSignal.any([lifetime.signal, request.signal]);
          result = { ok: true, value: await handler(input.data.payload, signal) };
        } catch (error) {
          result = { ok: false, error: { code: "scraper/rpc", message: error instanceof Error ? error.message : String(error), details: {} } };
        }
        return Response.json({ type: "server-response", rpcId: input.data.rpcId, result });
      },
    }));
  }
}
