import fs from "node:fs/promises";
import path from "node:path";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { ReadResourceResult } from "@modelcontextprotocol/server";
import { appTitle, type AppPlatform } from "../../router.js";

export const resources = {
  login: "ui://scraper/douyin/login",
  videos: "ui://scraper/douyin/search_videos",
  users: "ui://scraper/douyin/search_users",
  userDetail: "ui://scraper/douyin/user_detail",
  xiaohongshuLogin: "ui://scraper/xiaohongshu/login",
  xiaohongshuVideos: "ui://scraper/xiaohongshu/search_videos",
  xiaohongshuUsers: "ui://scraper/xiaohongshu/search_users",
  xiaohongshuUserDetail: "ui://scraper/xiaohongshu/user_detail",
} as const;

function videoProxyOrigins(): { connect: string[]; resource: string[] } {
  const configuredPort = Number(process.env.DOUYIN_VIDEO_PROXY_PORT ?? 42853);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 42853;
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  return { connect: origins, resource: origins };
}

const DIST_DIRECTORIES = import.meta.filename.endsWith(".ts")
  ? [path.resolve(import.meta.dirname, "../../../dist")]
  : [
      path.resolve(import.meta.dirname),
      path.resolve(import.meta.dirname, "../../../"),
  ];

export async function appHtmlText(): Promise<string> {
  let html: string | undefined;
  let lastError: unknown;
  for (const directory of DIST_DIRECTORIES) {
    try {
      html = await fs.readFile(path.join(directory, "mcp-app.html"), "utf8");
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (html === undefined) throw lastError ?? new Error("mcp-app.html was not found");
  return html;
}

export function withAppTitle(html: string, platform: AppPlatform): string {
  return html.replace(/<title>[^<]*<\/title>/, `<title>${appTitle(platform)}</title>`);
}

export async function appHtml(uri: string): Promise<ReadResourceResult> {
  const html = withAppTitle(await appHtmlText(), uri.startsWith("ui://scraper/xiaohongshu/") ? "xiaohongshu" : "douyin");
  const proxy = videoProxyOrigins();
  return {
    contents: [{
      uri,
      mimeType: RESOURCE_MIME_TYPE,
      text: html,
      _meta: {
        ui: {
          csp: {
            connectDomains: proxy.connect,
            resourceDomains: [
              "https://*.douyinvod.com",
              "https://*.douyinpic.com",
              "https://*.byteimg.com",
              "https://*.douyincdn.com",
              "https://*.snssdk.com",
              "https://*.xiaohongshu.com",
              "https://*.xhscdn.com",
              "https://*.xhscdn.net",
              "https://*.xhslink.com",
              ...proxy.resource,
            ],
          },
        },
      },
    }],
  };
}
