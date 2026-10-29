import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { appStore } from "../store.js";
import { getHttpAppUrl } from "../runtime-mode.js";
import type { DouyinUser, DouyinVideo, VideoCollectionResult, VideoListFilters, VideoListResult, VideoSearchSummary } from "../types.js";

export function failure(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[douyin] tool failed", error);
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    structuredContent: { error: message },
  };
}

export function success(text: string, structuredContent: object): CallToolResult {
  const toolName = resolveAppToolName(structuredContent);
  const jobId = typeof (structuredContent as { jobId?: unknown }).jobId === "string"
    ? (structuredContent as { jobId: string }).jobId
    : undefined;
  const exportId = (structuredContent as { exportId?: string }).exportId;
  const baseUrl = toolName ? getHttpAppUrl(toolName, jobId) : undefined;
  const appUrl = baseUrl && exportId ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}exportId=${encodeURIComponent(exportId)}` : baseUrl;
  return {
    content: [{ type: "text", text: appUrl ? `${text}\n\n打开 App：${appUrl}` : text }],
    structuredContent: {
      ...(structuredContent as Record<string, unknown>),
      ...(appUrl ? { appUrl } : {}),
    },
  };
}

function resolveAppToolName(structuredContent: object): string | undefined {
  const platform = (structuredContent as { platform?: unknown }).platform === "xiaohongshu" ? "xiaohongshu" : "douyin";
  const kind = (structuredContent as { kind?: unknown }).kind;
  if (kind === "login") return "douyin.get_cookie";
  if (kind === "xiaohongshu-login") return "xiaohongshu.get_cookie";
  if (kind === "user-search-summary" || kind === "page-user-search") return `${platform}.search_users`;
  if (kind === "user-detail-summary") return platform === "xiaohongshu" ? "xiaohongshu.collect_user_notes" : "douyin.collect_user_videos";
  if (kind === "video-search-summary" || kind === "video-list" || kind === "videos-export" || kind === "videos-export-job" || kind === "videos-deleted") return `${platform}.search_videos`;
  if (kind === "state" || kind === "browser-reload" || kind === "captcha-acknowledged") return "search_videos";
  const page = (structuredContent as { page?: unknown }).page;
  if (page === "user-search") return `${platform}.search_users`;
  if (page === "user-detail") return platform === "xiaohongshu" ? "xiaohongshu.collect_user_notes" : "douyin.collect_user_videos";
  if (page === "video-search") return `${platform}.search_videos`;
  return undefined;
}

export async function openExportFolder(filePath: string): Promise<string> {
  const target = path.resolve(filePath);
  const root = path.resolve(appStore.root);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("只能打开应用导出目录中的文件");
  }
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error("导出文件不存在");

  const folder = path.dirname(target);
  const launch = (command: string, args: string[], windowsHide = true) => new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide });
    child.once("error", reject);
    child.once("spawn", resolve);
    child.unref();
  });
  if (process.platform === "win32") await launch("explorer.exe", [`/select,${target}`], false);
  else if (process.platform === "darwin") await launch("open", [folder]);
  else await launch("xdg-open", [folder]);
  return folder;
}

export function collectionSummary(result: VideoCollectionResult, prefix = "本次采集结束"): string {
  const videoCount = result.items.filter((item) => item.type === "video").length;
  return [
    `${prefix}：`,
    `共采集页数 ${result.pages ?? 0} 页`,
    `共采集内容数量 ${result.items.length} 个，其中视频 ${videoCount} 个，图文 ${result.items.length - videoCount} 个`,
    "",
    "你可以继续以下操作：",
    result.hasMore === false ? "过滤指定内容（支持点赞、收藏、评论过滤）" : "继续翻页或过滤指定内容（支持点赞、收藏、评论过滤）",
  ].join("\n");
}

export function userCollectionSummary(result: { items: DouyinUser[]; pages?: number }): string {
  return ["本次用户采集结束：", `共采集页数 ${result.pages ?? 0} 页`, `共采集用户 ${result.items.length} 个`, "", "你可以继续查看用户作品或继续筛选用户。"].join("\n");
}

export function videoSearchStructuredSummary(result: VideoCollectionResult): VideoSearchSummary {
  const videoCount = result.items.filter((item) => item.type === "video").length;
  return {
    kind: "video-search-summary",
    jobId: result.jobId,
    keyword: result.keyword,
    filters: result.filters,
    pages: result.pages ?? 0,
    total: result.items.length,
    videoCount,
    imageTextCount: result.items.length - videoCount,
    hasMore: result.hasMore,
    ...(result.platform ? { platform: result.platform } : {}),
  };
}

function videoSummary(video: DouyinVideo) {
  const totalSeconds = Math.max(0, Math.round(video.durationMs / 1000));
  return {
    id: video.id,
    title: video.title,
    type: video.type,
    author: video.author,
    publishedAt: video.publishedAt,
    durationMs: video.durationMs,
    duration: `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`,
    likes: video.likes,
    favorites: video.favorites,
    comments: video.comments,
    shares: video.shares,
  };
}

function filterVideoList(items: DouyinVideo[], filters: VideoListFilters): DouyinVideo[] {
  const terms = (Array.isArray(filters.titleContains) ? filters.titleContains : [filters.titleContains])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().toLocaleLowerCase());
  return items.filter((item) => (
    (filters.favoritesGt === undefined || item.favorites > filters.favoritesGt)
    && (filters.likesGt === undefined || item.likes > filters.likesGt)
    && (filters.commentsGt === undefined || item.comments > filters.commentsGt)
    && (!filters.type || filters.type === "all" || item.type === filters.type)
    && (!terms.length || terms.some((term) => item.title.toLocaleLowerCase().includes(term)))
  ));
}

export function videoListStructuredResult(items: DouyinVideo[], page: number, pageSize: number, filters: VideoListFilters, jobId?: string): VideoListResult {
  const filtered = filterVideoList(items, filters);
  const pages = Math.ceil(filtered.length / pageSize);
  const start = (page - 1) * pageSize;
  return { kind: "video-list", jobId, page, pageSize, total: filtered.length, pages, hasMore: page < pages, items: filtered.slice(start, start + pageSize).map(videoSummary) };
}

export function videoListDescription(result: VideoListResult): string {
  return `已查询视频列表：第 ${result.page} 页，共 ${result.total} 条符合条件，返回 ${result.items.length} 条${result.hasMore ? "，还有更多" : "。"}`;
}

export function usersStructuredSummary(result: { kind: "users"; keyword: string; filters: unknown; items: DouyinUser[]; pages?: number; hasMore?: boolean }) {
  return { kind: "user-search-summary", jobId: (result as { jobId?: string; platform?: string }).jobId, platform: (result as { platform?: string }).platform, keyword: result.keyword, filters: result.filters, pages: result.pages ?? 0, total: result.items.length, hasMore: result.hasMore };
}

export function userDetailStructuredSummary(result: { kind: "user-detail"; secUid: string; user?: DouyinUser; items: DouyinVideo[]; pages?: number; hasMore?: boolean }) {
  return { kind: "user-detail-summary", jobId: (result as { jobId?: string }).jobId, secUid: result.secUid, hasUser: Boolean(result.user), pages: result.pages ?? 0, total: result.items.length, hasMore: result.hasMore };
}
