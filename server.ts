import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/server";
import { appHtml, resources } from "./src/server/mcp/app-resources.js";
import { registerBrowserTools } from "./src/server/mcp/tools/browser-tools.js";
import { registerStateTools } from "./src/server/mcp/tools/state-tools.js";
import { registerUserTools } from "./src/server/mcp/tools/user-tools.js";
import { registerVideoTools } from "./src/server/mcp/tools/video-tools.js";
import { registerXiaohongshuTools } from "./src/server/mcp/tools/xiaohongshu-tools.js";

/**
 * Assemble the Douyin MCP server from focused tool groups.
 *
 * Browser lifecycle and collection are exposed through the browser SDK, while
 * this file only owns MCP App resource registration and module composition.
 */
export type ServerOptions = {
  ui?: boolean;
};

export function createServer(options: ServerOptions = {}): McpServer {
  const uiEnabled = options.ui === true;
  const server = new McpServer({ name: "scraper", version: "0.1.0" });

  registerBrowserTools(server, uiEnabled);
  registerVideoTools(server, uiEnabled);
  registerUserTools(server, uiEnabled);
  registerStateTools(server, uiEnabled);
  registerXiaohongshuTools(server, uiEnabled);

  if (uiEnabled) {
    for (const [name, uri] of [
      ["抖音登录", resources.login],
      ["抖音视频搜索", resources.videos],
      ["抖音用户搜索", resources.users],
      ["抖音用户详情", resources.userDetail],
      ["小红书登录", resources.xiaohongshuLogin],
      ["小红书笔记搜索", resources.xiaohongshuVideos],
      ["小红书用户搜索", resources.xiaohongshuUsers],
      ["小红书用户笔记", resources.xiaohongshuUserDetail],
    ] as const) {
      registerAppResource(server, name, uri, { mimeType: RESOURCE_MIME_TYPE }, async () => appHtml(uri));
    }
  }

  return server;
}
