import { Client, StreamableHTTPClientTransport, type CallToolRequest, type CallToolResult } from "@modelcontextprotocol/client";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";

/**
 * Adapter used when the bundled page is opened directly over HTTP.
 *
 * The page keeps using the same App-shaped API as the MCP App view. Tool
 * calls go through the local Streamable HTTP MCP endpoint; model-context
 * methods are intentionally no-ops because an ordinary browser has no host
 * conversation to update.
 */
export class HttpAppClient {
  private readonly client = new Client({ name: "scraper-http-app", version: "0.1.0" });
  private readonly toolName: string;
  private connection?: Promise<void>;

  constructor(private readonly endpoint: string, toolName: string) {
    this.toolName = toolName || "douyin.search_videos";
  }

  asApp(): App {
    return this as unknown as App;
  }

  getHostContext(): McpUiHostContext {
    return {
      theme: "light",
      locale: "zh-CN",
      toolInfo: { tool: { name: this.toolName } as never },
    };
  }

  async callServerTool(params: CallToolRequest["params"]): Promise<CallToolResult> {
    await this.connect();
    return this.client.callTool(params);
  }

  async updateModelContext(): Promise<Record<string, unknown>> {
    return {};
  }

  async sendMessage(): Promise<{ isError?: boolean }> {
    return {};
  }

  private async connect(): Promise<void> {
    if (!this.connection) {
      const transport = new StreamableHTTPClientTransport(new URL(this.endpoint));
      this.connection = this.client.connect(transport).catch((error) => {
        this.connection = undefined;
        throw error;
      });
    }
    await this.connection;
  }
}
