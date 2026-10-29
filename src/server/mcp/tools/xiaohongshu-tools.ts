import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { douyinCollector, xiaohongshuCollector, xiaohongshuLoginService } from "../../browser/index.js";
import { appStore } from "../../store.js";
import type { VideoCollectionResult } from "../../types.js";
import { collectionSummary, failure, success, usersStructuredSummary, userDetailStructuredSummary, videoListDescription, videoListStructuredResult, videoSearchStructuredSummary, userCollectionSummary } from "../responses.js";
import { resources } from "../app-resources.js";
import { registerScraperTool } from "../register-tool.js";
import { videoListFiltersInput, xiaohongshuVideoFiltersInput } from "../schemas.js";
import { exportJobs } from "../../video-export.js";

export function registerXiaohongshuTools(server: McpServer, uiEnabled: boolean): void {
  registerScraperTool(server, uiEnabled, "xiaohongshu.get_cookie", {
    title: "连接小红书账号",
    description: "打开小红书并等待登录，监听用户信息接口保存当前平台会话。无参数，示例：{}。",
    inputSchema: z.object({}).strict(),
    _meta: { ui: { resourceUri: resources.xiaohongshuLogin } },
  }, async () => {
    try {
      const result = await xiaohongshuLoginService.begin();
      const profile = result.profile;
      return success(`小红书登录成功：${profile?.nickname || "未命名用户"}。`, {
        kind: "xiaohongshu-login",
        platform: "xiaohongshu",
        profile,
        cookieCount: result.cookieCount,
      });
    } catch (error) {
      return failure(error);
    }
  });

  registerScraperTool(server, uiEnabled, "xiaohongshu.search_videos", {
    title: "采集小红书笔记",
    description: "按关键词搜索小红书笔记。参数：keyword 可选字符串，省略时只打开搜索页；maxPages 可选整数，默认 10；filters 可选对象或 JSON 字符串，字段为 sort（general/latest/most-liked/most-commented/most-collected）、publishTime（all/day/week/half-year）、contentType（all/video/image-text）、searchScope（all/following/watched/unwatched）、location（all/city/nearby）。示例：{\"keyword\":\"儿童玩具\",\"maxPages\":5,\"filters\":{\"contentType\":\"video\"}}。",
    inputSchema: z.object({
      keyword: z.string().trim().min(1).optional().describe("搜索关键词；省略时只打开搜索页面"),
      maxPages: z.coerce.number().int().min(1).max(50).default(10).describe("最多采集页数，默认 10"),
      filters: xiaohongshuVideoFiltersInput,
    }).strict(),
    _meta: { ui: { resourceUri: resources.xiaohongshuVideos } },
  }, async ({ keyword, maxPages, filters }) => {
    try {
      if (!keyword) return success("已打开小红书笔记搜索页面。", { kind: "page", page: "video-search", platform: "xiaohongshu" });
      const result = await douyinCollector.videos({ keyword, maxPages, filters, platform: "xiaohongshu" });
      return success(collectionSummary(result, "本次小红书采集结束"), videoSearchStructuredSummary(result));
    } catch (error) {
      return failure(error);
    }
  });

  registerScraperTool(server, uiEnabled, "xiaohongshu.search_users", {
    title: "采集小红书用户",
    description: "按关键词搜索小红书用户。参数：keyword 可选字符串，省略时只打开用户搜索页；maxPages 可选整数，默认 10。示例：{\"keyword\":\"儿童玩具\",\"maxPages\":5}。",
    inputSchema: z.object({
      keyword: z.string().trim().min(1).optional().describe("搜索关键词；省略时只打开用户搜索页"),
      maxPages: z.coerce.number().int().min(1).max(50).default(10).describe("最多采集页数，默认 10"),
    }).strict(),
    _meta: { ui: { resourceUri: resources.xiaohongshuUsers } },
  }, async ({ keyword, maxPages }) => {
    try {
      if (!keyword) return success("已打开小红书用户搜索页面。", { kind: "page", page: "user-search", platform: "xiaohongshu" });
      const result = await douyinCollector.users({ keyword, maxPages, filters: { followerCount: "all", userType: "all" }, platform: "xiaohongshu" });
      return success(userCollectionSummary(result), usersStructuredSummary(result));
    } catch (error) {
      return failure(error);
    }
  });

  registerScraperTool(server, uiEnabled, "xiaohongshu.collect_user_notes", {
    title: "采集小红书用户笔记",
    description: "采集指定小红书用户发布的笔记，最多 10 页，并保存为 CSV。参数：secUid 必填，用户 ID；xsecToken 可选，用户搜索结果中的 xsec_token；maxPages 可选整数，默认 10。示例：{\"secUid\":\"user-id\",\"xsecToken\":\"token\",\"maxPages\":5}。",
    inputSchema: z.object({
      secUid: z.string().trim().min(1).describe("小红书用户 ID"),
      xsecToken: z.string().trim().optional().describe("用户搜索结果中的 xsec_token"),
      maxPages: z.coerce.number().int().min(1).max(10).default(10).describe("最多采集页数，默认 10"),
    }).strict(),
    _meta: { ui: { resourceUri: resources.xiaohongshuUserDetail } },
  }, async ({ secUid, xsecToken, maxPages }) => {
    try {
      const result = await xiaohongshuCollector.userNotes({ secUid, xsecToken, maxPages, platform: "xiaohongshu" });
      const summary = `已采集小红书用户笔记：共 ${result.items.length} 条，${result.pages ?? 0} 页。CSV：${result.filePath ?? "未生成"}`;
      return success(summary, { ...userDetailStructuredSummary(result), platform: "xiaohongshu", filePath: result.filePath });
    } catch (error) {
      return failure(error);
    }
  });

  registerScraperTool(server, uiEnabled, "xiaohongshu.list_videos", {
    title: "查询已采集小红书笔记",
    description: "查询已采集的小红书笔记摘要。参数：jobId 可选；page 默认 1；pageSize 默认 100；filters 可选对象，支持 favoritesGt、likesGt、commentsGt、type、titleContains。示例：{\"page\":1,\"pageSize\":100,\"filters\":{\"likesGt\":20}}。",
    inputSchema: z.object({ jobId: z.string().trim().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(500).default(100), filters: videoListFiltersInput }).strict(),
    _meta: { ui: { resourceUri: resources.xiaohongshuVideos } },
  }, async ({ jobId, page, pageSize, filters }) => {
    await appStore.initialize();
    const source = await appStore.loadVideoResult(jobId);
    const items = source?.platform === "xiaohongshu" ? source.items : [];
    const result = videoListStructuredResult(items, page, pageSize, filters, source?.jobId);
    return success(videoListDescription(result), result as unknown as Record<string, unknown>);
  });

  registerScraperTool(server, uiEnabled, "xiaohongshu.export_videos", {
    title: "导出小红书笔记",
    description: "后台导出指定小红书笔记为 CSV、下载视频并生成 manifest。立即返回 exportId，必须调用 state.get_export 查询进度及最终文件地址。参数：jobId 可选；ids 为笔记 ID 数组。示例：{\"ids\":[\"note-id-1\"]}。",
    inputSchema: z.object({ jobId: z.string().trim().optional(), ids: z.array(z.string().trim().min(1)).default([]) }).strict(),
    _meta: { ui: { resourceUri: resources.xiaohongshuVideos } },
  }, async ({ jobId, ids }) => {
    await appStore.initialize();
    const source = await appStore.loadVideoResult(jobId);
    const videos = source?.platform === "xiaohongshu" ? source.items.filter((item) => new Set(ids).has(item.id)) : [];
    if (!videos.length) return success("没有匹配到可导出的小红书笔记。", { kind: "videos-export", platform: "xiaohongshu", count: 0 });
    try {
      const job = exportJobs.start(videos);
      return success("已提交后台保存任务，请用 state.get_export 和 exportId 查询进度及最终文件地址。", { ...job, platform: "xiaohongshu" });
    } catch (error) {
      return failure(error);
    }
  });

  registerScraperTool(server, uiEnabled, "xiaohongshu.delete_videos", {
    title: "删除已采集小红书笔记",
    description: "从当前小红书笔记列表中删除指定内容。参数：jobId 可选；ids 为笔记 ID 数组。示例：{\"ids\":[\"note-id-1\"]}。",
    inputSchema: z.object({ jobId: z.string().trim().optional(), ids: z.array(z.string().trim().min(1)).default([]) }).strict(),
    _meta: { ui: { resourceUri: resources.xiaohongshuVideos } },
  }, async ({ jobId, ids }) => {
    await appStore.initialize();
    const current = await appStore.loadVideoResult(jobId);
    if (!current || current.platform !== "xiaohongshu") return success("当前没有已采集的小红书笔记可删除。", { kind: "videos-deleted", platform: "xiaohongshu", deletedCount: 0, remainingCount: 0 });
    const wanted = new Set(ids);
    const remaining = current.items.filter((item) => !wanted.has(item.id));
    const deletedCount = current.items.length - remaining.length;
    const result: VideoCollectionResult = { ...current, items: remaining, collectedAt: new Date().toISOString() };
    if (deletedCount > 0) await appStore.update({ lastVideos: result, videoProgress: { ...appStore.snapshot().videoProgress, itemCount: remaining.length } });
    return success(`已删除 ${deletedCount} 条小红书笔记，剩余 ${remaining.length} 条。`, { kind: "videos-deleted", platform: "xiaohongshu", jobId: result.jobId, deletedCount, remainingCount: remaining.length });
  });

  registerScraperTool(server, uiEnabled, "xiaohongshu.play_video", {
    title: "播放小红书视频",
    description: "打开小红书笔记详情并获取视频播放地址。参数：videoId 为笔记 ID；xsecToken 为搜索结果中的 xsec_token。示例：{\"videoId\":\"note-id-1\",\"xsecToken\":\"token\"}。",
    inputSchema: z.object({
      videoId: z.string().trim().min(1).describe("笔记 ID"),
      xsecToken: z.string().trim().min(1).describe("搜索结果中的 xsec_token"),
    }).strict(),
    _meta: { ui: { resourceUri: resources.xiaohongshuVideos, visibility: ["app"] } },
  }, async ({ videoId, xsecToken }) => {
    console.error(`[scraper] xiaohongshu.play_video called videoId=${videoId} hasXsecToken=${Boolean(xsecToken)}`);
    try {
      const result = await douyinCollector.playVideo(videoId, "", "xiaohongshu", xsecToken);
      return success("已获取小红书视频播放地址。", { kind: "video-player", ...result });
    } catch (error) {
      return failure(error);
    }
  });
}
