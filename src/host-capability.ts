import type { App, McpUiHostCapabilities } from "@modelcontextprotocol/ext-apps";

export type AppRuntime = {
  mode: "mcp" | "http";
  canCallServerTool: boolean;
  canSendMessage: boolean;
  canUpdateModelContext: boolean;
  canOpenLink: boolean;
  directCommunication: boolean;
};

export function mcpAppRuntime(app: App): AppRuntime {
  const capabilities = app.getHostCapabilities() as McpUiHostCapabilities | undefined;
  const canSendMessage = Boolean(capabilities?.message);
  const canUpdateModelContext = Boolean(capabilities?.updateModelContext);
  return {
    mode: "mcp",
    canCallServerTool: true,
    canSendMessage,
    canUpdateModelContext,
    canOpenLink: true,
    directCommunication: canSendMessage || canUpdateModelContext,
  };
}

export function canUpdateModelContext(app: App): boolean {
  const host = app as App & {
    getHostCapabilities?: () => McpUiHostCapabilities | undefined;
  };
  return Boolean(host.getHostCapabilities?.()?.updateModelContext);
}

export const httpAppRuntime: AppRuntime = {
  mode: "http",
  canCallServerTool: true,
  canSendMessage: false,
  canUpdateModelContext: false,
  canOpenLink: true,
  directCommunication: false,
};
