import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";

type ToolConfig = {
  _meta?: {
    ui?: {
      visibility?: string[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type ToolHandler = (...args: any[]) => any;

/**
 * Register a tool in MCP Apps mode or plain MCP mode.
 *
 * In plain MCP mode, every tool remains available to the HTTP App and to
 * clients that do not render MCP Apps. In UI mode, every tool that declares
 * a resource URI keeps its MCP Apps metadata; tools without a UI remain plain
 * MCP tools.
 */
export function registerScraperTool(
  server: McpServer,
  uiEnabled: boolean,
  name: string,
  config: ToolConfig,
  handler: ToolHandler,
): void {
  if (uiEnabled && config._meta?.ui?.resourceUri) {
    const resourceUri = config._meta.ui.resourceUri;
    const widgetConfig: ToolConfig = {
      ...config,
      _meta: {
        ...config._meta,
        // Keep both metadata dialects: MCP Apps hosts use ui.resourceUri,
        // while Codex-style Agent Plugin hosts resolve widgets from the
        // OpenAI outputTemplate key.
        "openai/outputTemplate": resourceUri,
        "openai/widgetAccessible": true,
      },
    };
    registerAppTool(server, name, widgetConfig as never, handler as never);
    return;
  }

  const { _meta: _ignored, ...plainConfig } = config;
  server.registerTool(name, plainConfig as never, handler as never);
}
