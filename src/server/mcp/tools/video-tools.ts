import { McpServer } from "@modelcontextprotocol/server";
import { exportJobs } from "../../video-export.js";
import { z } from "zod";
import { douyinCollector } from "../../browser/index.js";
import { appStore } from "../../store.js";
import type { DouyinVideo, VideoCollectionResult, VideoSearchInput } from "../../types.js";
import { resources } from "../app-resources.js";
import { collectionSummary, failure, success, videoListDescription, videoListStructuredResult, videoSearchStructuredSummary } from "../responses.js";
import { videoFiltersInput, videoListFiltersInput, videoPayload } from "../schemas.js";
import { registerScraperTool } from "../register-tool.js";

export function registerVideoTools(server: McpServer, uiEnabled: boolean): void {
  registerScraperTool(server, uiEnabled, "douyin.search_videos", {
    title: "采集抖音视频",
    description: "按关键词搜索抖音视频。参数：keyword 可选字符串，省略时只打开搜索页面；maxPages 可选整数，默认 10；filters 可选对象或 JSON 字符串，字段为 sort（general/latest/most-liked）、publishTime（all/day/week/half-year）、duration（all/short/medium/long）、searchScope（all/following/watched/unwatched）、contentType（all/video/image-text）。示例：{\"keyword\":\"儿童玩具\",\"maxPages\":5,\"filters\":{\"contentType\":\"video\"}}。返回采集页数、内容总数及视频/图文数量摘要。",
    inputSchema: z.object({
      keyword: z.string().trim().min(1, "keyword 不能为空；如果只打开页面，请传入空对象 {}").optional().describe("搜索关键词；省略时只打开搜索页面"),
      filters: videoFiltersInput,
      maxPages: z.coerce.number().int().min(1).max(50).default(10).describe("最多采集页数，默认 10"),
    }).strict(),
    _meta: { ui: { resourceUri: resources.videos } },
  }, async (args) => {
    try {
      if (!args.keyword) return success("已打开视频搜索页面。", { kind: "page", page: "video-search" });
      const result = await douyinCollector.videos(args as VideoSearchInput);
      return success(collectionSummary(result), videoSearchStructuredSummary(result));
    } catch (error) {
      return failure(error);
    }
  });

  registerScraperTool(server, uiEnabled, "douyin.filter_videos", {
    title: "过滤已采集视频",
    description: "按数量过滤视频列表。参数：jobId 可选任务 ID；favoritesGt、likesGt、commentsGt 为可选数字，表示对应数量严格大于该值。示例：{\"jobId\":\"job-123\",\"likesGt\":200,\"favoritesGt\":100}。",
    inputSchema: z.object({
      jobId: z.string().trim().optional().describe("搜索任务 ID；省略时使用最近任务"),
      favoritesGt: z.coerce.number().min(0).optional().describe("收藏数严格大于该值"),
      likesGt: z.coerce.number().min(0).optional().describe("点赞数严格大于该值"),
      commentsGt: z.coerce.number().min(0).optional().describe("评论数严格大于该值"),
    }).strict(),
    _meta: { ui: { resourceUri: resources.videos } },
  }, async ({ jobId, favoritesGt, likesGt, commentsGt }) => {
    await appStore.initialize();
    const sourceResult = await appStore.loadVideoResult(jobId);
    const source = sourceResult?.items ?? [];
    const result = videoListStructuredResult(source, 1, 100, { favoritesGt, likesGt, commentsGt }, sourceResult?.jobId);
    const conditions = [
      favoritesGt === undefined ? "" : `收藏数 > ${favoritesGt}`,
      likesGt === undefined ? "" : `点赞数 > ${likesGt}`,
      commentsGt === undefined ? "" : `评论数 > ${commentsGt}`,
    ].filter(Boolean).join("，") || "无过滤条件";
    return success(`已按${conditions}过滤，剩余 ${result.total} 条内容。`, result as unknown as Record<string, unknown>);
  });

  registerScraperTool(server, uiEnabled, "douyin.list_videos", {
    title: "查询已采集视频",
    description: "查询已采集的视频列表。参数：jobId 可选任务 ID；page 默认 1；pageSize 默认 100；filters 可选对象，支持 favoritesGt、likesGt、commentsGt、type、titleContains。示例：{\"jobId\":\"job-123\",\"page\":1,\"pageSize\":100,\"filters\":{\"likesGt\":20,\"type\":\"video\",\"titleContains\":\"老板\"}}。",
    inputSchema: z.object({
      jobId: z.string().trim().optional().describe("搜索任务 ID；省略时使用最近任务"),
      page: z.coerce.number().int().min(1).default(1).describe("页码，从 1 开始"),
      pageSize: z.coerce.number().int().min(1).max(500).default(100).describe("每页数量，默认 100"),
      filters: videoListFiltersInput,
    }).strict(),
    _meta: { ui: { resourceUri: resources.videos } },
  }, async ({ jobId, page, pageSize, filters }) => {
    await appStore.initialize();
    const sourceResult = await appStore.loadVideoResult(jobId);
    const source = sourceResult?.items ?? [];
    const result = videoListStructuredResult(source, page, pageSize, filters, sourceResult?.jobId);
    return success(videoListDescription(result), result as unknown as Record<string, unknown>);
  });

  registerScraperTool(server, uiEnabled, "douyin.export_videos", {
    title: "导出已采集视频",
    description: "后台保存指定视频的 CSV 数据、下载视频并生成 manifest.json。立即返回 exportId，必须调用 state.get_export 查询进度和最终文件地址。参数：jobId 可选任务 ID；ids 为视频 ID 数组。示例：{\"jobId\":\"job-123\",\"ids\":[\"123\",\"456\"]}。",
    inputSchema: z.object({ jobId: z.string().trim().optional().describe("搜索任务 ID；省略时使用最近任务"), ids: z.array(z.string().trim().min(1)).default([]).describe("要保存的视频 ID 列表") }).strict(),
    _meta: { ui: { resourceUri: resources.videos } },
  }, async ({ jobId, ids }) => {
    await appStore.initialize();
    const source = (await appStore.loadVideoResult(jobId))?.items ?? [];
    const wanted = new Set(ids);
    const videos = source.filter((video) => wanted.has(video.id));
    const ignoredCount = Math.max(0, new Set(ids).size - videos.length);
    if (!videos.length) return success("没有匹配到可导出的视频。", { kind: "videos-export", count: 0, ignoredCount });
    try {
      const job = exportJobs.start(videos as DouyinVideo[]);
      return success(`已提交 ${videos.length} 条数据的保存任务。请用 state.get_export 和 exportId 查询进度及最终文件地址。`, { ...job, ignoredCount });
    } catch (error) {
      return failure(error);
    }
  });

  registerScraperTool(server, uiEnabled, "douyin.delete_videos", {
    title: "删除已采集视频",
    description: "从已采集视频列表中删除指定视频。参数：jobId 可选任务 ID；ids 为视频 ID 字符串数组。示例：{\"jobId\":\"job-123\",\"ids\":[\"123\",\"456\"]}。",
    inputSchema: z.object({ jobId: z.string().trim().optional().describe("搜索任务 ID；省略时使用最近任务"), ids: z.array(z.string().trim().min(1)).default([]).describe("要删除的视频 ID 列表") }).strict(),
    _meta: { ui: { resourceUri: resources.videos } },
  }, async ({ jobId, ids }) => {
    await appStore.initialize();
    const state = appStore.snapshot();
    const current = await appStore.loadVideoResult(jobId);
    if (!current) return success("当前没有已采集的视频可删除。", { kind: "videos-deleted", deletedCount: 0, remainingCount: 0 });
    const wanted = new Set(ids);
    const remaining = current.items.filter((video) => !wanted.has(video.id));
    const deletedCount = current.items.length - remaining.length;
    if (deletedCount === 0) return success("没有匹配到可删除的视频。", { kind: "videos-deleted", deletedCount: 0, remainingCount: current.items.length });
    const result: VideoCollectionResult = { ...current, items: remaining, collectedAt: new Date().toISOString() };
    await appStore.update({ lastVideos: result, videoProgress: { ...state.videoProgress, itemCount: remaining.length } });
    return success(`已删除 ${deletedCount} 条视频，剩余 ${remaining.length} 条。`, { kind: "videos-deleted", jobId: result.jobId, deletedCount, remainingCount: remaining.length });
  });

  registerScraperTool(server, uiEnabled, "douyin.play_video", {
    title: "播放抖音视频",
    description: "为视频采集页面准备播放地址。参数：videoId 为视频 ID；playUrl 为视频播放地址。示例：{\"videoId\":\"123\",\"playUrl\":\"https://example.com/video.mp4\"}。返回播放器地址。",
    inputSchema: z.object({
      videoId: z.string().trim().min(1).describe("视频 ID"),
      playUrl: z.string().url().describe("视频播放地址"),
    }),
    _meta: { ui: { resourceUri: resources.videos, visibility: ["app"] } },
  }, async ({ videoId, playUrl }) => {
    try {
      const result = await douyinCollector.playVideo(videoId, playUrl);
      return success("已获取视频播放地址。", { kind: "video-player", ...result });
    } catch (error) {
      return failure(error);
    }
  });

  registerScraperTool(server, uiEnabled, "state.export_videos", {
    title: "后台保存选中的内容",
    description: "创建后台保存任务，立即返回 exportId；使用 state.get_export 查询进度，完成后返回 CSV 和 manifest 地址。参数：videos 为非空视频对象数组。",
    inputSchema: z.object({ videos: z.array(videoPayload).min(1) }),
    _meta: { ui: { resourceUri: resources.videos, visibility: ["app"] } },
  }, async ({ videos }) => {
    try {
      const job = exportJobs.start(videos as DouyinVideo[]);
      return success(`已提交 ${videos.length} 条数据的保存任务。请用 state.get_export 和 exportId 查询进度及最终文件地址。`, { ...job });
    } catch (error) {
      return failure(error);
    }
  });

  registerScraperTool(server, uiEnabled, "state.get_export", {
    title: "查询保存进度",
    description: "按 exportId 查询后台保存任务。queued/running 时继续查询；completed 时 result 含 CSV、manifest 地址和下载统计；failed/cancelled 含 error。任务在服务重启后失效，完成记录保留一小时（最多 100 个任务）。",
    inputSchema: z.object({ exportId: z.string().uuid() }).strict(),
    _meta: { ui: { resourceUri: resources.videos } },
  }, async ({ exportId }) => {
    try {
      const job = exportJobs.get(exportId);
      return success(job.status === "completed" ? "保存完成，文件地址见 result。" : job.error ?? "已获取保存进度。", { ...job });
    } catch (error) { return failure(error); }
  });
}
