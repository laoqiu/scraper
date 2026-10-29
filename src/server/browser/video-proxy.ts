import http from "node:http";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { PlatformAdapter } from "../platform/types.js";
import type { PlatformId } from "../types.js";
import { detectPlatformByMediaUrl, getPlatformAdapter } from "../platform/adapters.js";

interface VideoSource {
  url: string;
  platform: PlatformAdapter;
  cookie: string;
  userAgent: string;
  referer?: string;
  expiresAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const DEFAULT_PROXY_PORT = 42853;
const UPSTREAM_RETRY_COUNT = 2;
const UPSTREAM_RETRY_DELAY_MS = 250;

function shouldRetryUpstream(status: number): boolean {
  return status === 401 || status === 403 || status === 408 || status === 425 || status === 429 || status >= 500;
}

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class VideoProxy {
  private server?: http.Server;
  private port?: number;
  private sources = new Map<string, VideoSource>();
  private reportedRequests = new Set<string>();

  private async start(): Promise<void> {
    if (this.server && this.port) return;
    this.server = http.createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      server.once("error", reject);
      const port = Number(process.env.DOUYIN_VIDEO_PROXY_PORT) || DEFAULT_PROXY_PORT;
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("视频流服务启动失败"));
          return;
        }
        this.port = address.port;
        resolve();
      });
    });
  }

  async register(url: string, cookie: string, userAgent: string, options: { platform?: PlatformId; referer?: string } = {}): Promise<string> {
    const platform = options.platform ? getPlatformAdapter(options.platform) : detectPlatformByMediaUrl(url);
    if (!platform) throw new Error("视频播放地址不是受支持的平台地址");
    await this.start();
    const token = randomUUID();
    this.sources.set(token, { url, platform, cookie, userAgent, referer: options.referer, expiresAt: Date.now() + TTL_MS });
    const proxyUrl = `http://127.0.0.1:${this.port}/video/${token}`;
    console.error(`[scraper] video proxy registered platform=${platform.id} source=${url} proxy=${proxyUrl} referer=${options.referer || platform.media.referer}`);
    setTimeout(() => {
      this.sources.delete(token);
      this.reportedRequests.delete(token);
    }, TTL_MS).unref();
    return proxyUrl;
  }

  async download(url: string, cookie: string, userAgent: string, target: string, signal?: AbortSignal): Promise<void> {
    const platform = detectPlatformByMediaUrl(url);
    if (!platform) throw new Error("视频下载地址不是受支持的平台地址");
    let lastError: unknown;
    for (let attempt = 0; attempt <= UPSTREAM_RETRY_COUNT; attempt += 1) {
      let upstream: Response;
      try {
        upstream = await fetch(url, {
          headers: this.upstreamHeaders(platform, cookie, userAgent),
          signal,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error;
        if (attempt === UPSTREAM_RETRY_COUNT) throw error;
        await delay(UPSTREAM_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }

      if (!upstream.ok || !upstream.body) {
        const detail = await upstream.text().catch(() => "");
        const error = new Error(`视频下载失败（HTTP ${upstream.status}）${detail ? `：${detail.slice(0, 160)}` : ""}`);
        if (!shouldRetryUpstream(upstream.status) || attempt === UPSTREAM_RETRY_COUNT) throw error;
        lastError = error;
        await upstream.body?.cancel().catch(() => undefined);
      } else {
        try {
          await pipeline(Readable.fromWeb(upstream.body as never), createWriteStream(target), { signal });
          return;
        } catch (error) {
          if (signal?.aborted) throw error;
          lastError = error;
          if (attempt === UPSTREAM_RETRY_COUNT) throw error;
        }
      }
      await delay(UPSTREAM_RETRY_DELAY_MS * (attempt + 1));
    }
    throw lastError instanceof Error ? lastError : new Error("视频下载失败");
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end();
      return;
    }
    const token = request.url?.match(/^\/video\/([^/?]+)$/)?.[1];
    const source = token ? this.sources.get(token) : undefined;
    if (!source || source.expiresAt <= Date.now()) {
      response.writeHead(404).end("视频地址已失效");
      return;
    }
    if (!this.reportedRequests.has(token!)) {
      this.reportedRequests.add(token!);
      console.error(`[scraper] video proxy request platform=${source.platform.id} source=${source.url} referer=${source.referer || source.platform.media.referer} range=${request.headers.range || "none"}`);
    }
    try {
      const range = request.headers.range;
      let upstream: Response | undefined;
      let lastError: unknown;
      for (let attempt = 0; attempt <= UPSTREAM_RETRY_COUNT; attempt += 1) {
        try {
          upstream = await fetch(source.url, {
            headers: {
              ...this.upstreamHeaders(
                source.platform,
                source.cookie,
                source.userAgent,
                attempt > 0 && source.referer !== source.platform.media.referer ? source.platform.media.referer : source.referer,
              ),
              Accept: "video/*,*/*;q=0.8",
              ...(range ? { Range: range } : {}),
            },
          });
          if (!upstream.ok) {
            console.error(`[scraper] video proxy upstream status=${upstream.status} platform=${source.platform.id} source=${source.url} referer=${source.referer || source.platform.media.referer} attempt=${attempt + 1}`);
          }
          if ((upstream.ok && upstream.body) || attempt === UPSTREAM_RETRY_COUNT || (!upstream.ok && !shouldRetryUpstream(upstream.status))) break;
          await upstream.body?.cancel().catch(() => undefined);
        } catch (error) {
          lastError = error;
          if (attempt === UPSTREAM_RETRY_COUNT) throw error;
        }
        await delay(UPSTREAM_RETRY_DELAY_MS * (attempt + 1));
      }
      if (!upstream) throw lastError instanceof Error ? lastError : new Error("视频流请求失败");
      const headers: Record<string, string> = {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Accept-Ranges": "bytes",
      };
      for (const name of ["content-type", "content-length", "content-range"]) {
        const value = upstream.headers.get(name);
        if (value) headers[name] = value;
      }
      response.writeHead(upstream.status, headers);
      if (request.method === "HEAD" || !upstream.body) {
        response.end();
        return;
      }
      await pipeline(Readable.fromWeb(upstream.body as never), response);
    } catch (error) {
      if (!response.headersSent) response.writeHead(502);
      response.end(error instanceof Error ? error.message : "视频流请求失败");
    }
  }

  private upstreamHeaders(platform: PlatformAdapter, cookie: string, userAgent: string, referer?: string): Record<string, string> {
    return {
      Referer: referer || platform.media.referer,
      Origin: platform.media.origin,
      "User-Agent": userAgent,
      ...(cookie ? { Cookie: cookie } : {}),
    };
  }

  async close(): Promise<void> {
    this.sources.clear();
    this.reportedRequests.clear();
    const server = this.server;
    this.server = undefined;
    this.port = undefined;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export const videoProxy = new VideoProxy();
