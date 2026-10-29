import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { McpServer } from "@modelcontextprotocol/server";
import { appHtmlText, withAppTitle } from "./mcp/app-resources.js";
import { platformForToolName, toolNameForPath } from "../router.js";

const APP_PATHS = new Set([
  "/",
  "/app",
  "/login",
  "/search_videos",
  "/search_users",
  "/user_detail",
]);

export class HttpAppServer {
  private server?: Server;
  private _baseUrl?: string;
  private mcpServer?: McpServer;
  private mcpTransport?: NodeStreamableHTTPServerTransport;

  constructor(private readonly createMcpServer: () => McpServer) {}

  get baseUrl(): string {
    if (!this._baseUrl) throw new Error("Douyin HTTP App 服务尚未启动");
    return this._baseUrl;
  }

  async start(): Promise<string> {
    if (this.server) return this.baseUrl;
    const host = process.env.DOUYIN_HTTP_HOST?.trim() || "127.0.0.1";
    const configuredPort = Number(process.env.DOUYIN_HTTP_PORT ?? 0);
    const port = Number.isInteger(configuredPort) && configuredPort >= 0 ? configuredPort : 0;
    const html = await appHtmlText();
    const mcpServer = this.createMcpServer();
    const mcpTransport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcpServer.connect(mcpTransport);
    const server = createServer((request, response) => {
      void this.handle(request.url ?? "/", request.method ?? "GET", request, response, html, mcpTransport).catch((error) => {
        console.error("[douyin] HTTP App request failed", error);
        if (response.headersSent) response.destroy(error instanceof Error ? error : undefined);
        else this.writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      });
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("无法读取 Douyin HTTP App 服务端口");
    }
    this.server = server;
    this.mcpServer = mcpServer;
    this.mcpTransport = mcpTransport;
    this._baseUrl = `http://${host}:${address.port}`;
    console.error(`[douyin] HTTP App listening at ${this._baseUrl}`);
    return this._baseUrl;
  }

  async close(): Promise<void> {
    const server = this.server;
    const mcpServer = this.mcpServer;
    const mcpTransport = this.mcpTransport;
    this.server = undefined;
    this.mcpServer = undefined;
    this.mcpTransport = undefined;
    this._baseUrl = undefined;
    await mcpTransport?.close().catch(() => undefined);
    await mcpServer?.close().catch(() => undefined);
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(
    url: string,
    method: string,
    request: IncomingMessage,
    response: ServerResponse,
    html: string,
    mcpTransport: NodeStreamableHTTPServerTransport,
  ): Promise<void> {
    const pathname = new URL(url, "http://localhost").pathname;
    if (pathname === "/mcp") {
      await mcpTransport.handleRequest(request, response);
      return;
    }
    if (method === "GET" && (pathname === "/health" || pathname === "/api/health")) {
      this.writeJson(response, 200, { ok: true, mode: "http" });
      return;
    }
    if (method === "GET" && (APP_PATHS.has(pathname) || pathname.startsWith("/app/") || pathname.startsWith("/xiaohongshu/"))) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(withAppTitle(html, platformForToolName(toolNameForPath(pathname))));
      return;
    }
    this.writeJson(response, 404, { error: "Not found" });
  }

  private writeJson(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify(value));
  }
}
