import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { browserManager, douyinCollector, xiaohongshuCollector } from "../../browser/index.js";
import { appStore } from "../../store.js";
import { resources } from "../app-resources.js";
import { failure, openExportFolder, success } from "../responses.js";
import { registerScraperTool } from "../register-tool.js";

export function registerStateTools(server: McpServer, uiEnabled: boolean): void {
  registerScraperTool(server, uiEnabled, "state.get", {
    title: "读取抖音采集状态",
    description: "读取抖音采集状态。参数：secUid 可选，用于读取指定用户的作品状态。示例：{\"secUid\":\"MS4wLjABAAAA...\"}。",
    inputSchema: z.object({
      secUid: z.string().trim().optional().describe("用户 secUid；省略时读取全局状态"),
      jobId: z.string().trim().optional().describe("任务 ID；传入后读取对应搜索结果"),
    }),
    _meta: { ui: { resourceUri: resources.videos, visibility: ["app"] } },
  }, async ({ secUid, jobId }) => {
    await appStore.initialize();
    if (!browserManager.getBrowserDependencyState().ready) {
      void browserManager.prepareBrowser();
    }
    const state = secUid ? await appStore.snapshotForUserDetail(secUid) : appStore.snapshot();
    const browserDependency = browserManager.getBrowserDependencyState();
    state.browser = {
      ...state.browser,
      dependency: browserDependency,
    };
    if (jobId) {
      const [videos, users, detail] = await Promise.all([
        appStore.loadVideoResult(jobId),
        appStore.loadUserResult(jobId),
        appStore.loadUserDetailResult(jobId),
      ]);
      if (videos) state.lastVideos = videos;
      if (users) state.lastUsers = users;
      if (detail) state.lastUserDetail = detail;
    }
    const persistedAccount = await appStore.loadLoginAccount();
    if (!state.login.account && persistedAccount?.uid) {
      state.login.account = {
        uid: persistedAccount.uid,
        secUid: "",
        douyinId: persistedAccount.unique_id ?? "",
        uniqueId: persistedAccount.unique_id ?? "",
        nickname: persistedAccount.nickname ?? "",
        signature: persistedAccount.signature ?? "",
        city: persistedAccount.city ?? "",
        bindPhone: persistedAccount.bind_phone ?? "",
        gender: persistedAccount.gender ?? 0,
        avatarUrl: persistedAccount.avatar ?? undefined,
        followerCount: persistedAccount.follower_count ?? 0,
        followingCount: persistedAccount.following_count ?? 0,
        videoCount: 0,
      };
    }
    if (state.userProgress.status === "collecting" && !douyinCollector.isUserSearchRunning() && !xiaohongshuCollector.isUserSearchRunning()) {
      state.userProgress = { ...state.userProgress, status: "idle", message: "上次用户采集未完成" };
    }
    return success(`已读取抖音采集状态。浏览器依赖${browserDependency.ready ? "已就绪" : browserDependency.message}。`, { kind: "state", state });
  });

  registerScraperTool(server, uiEnabled, "state.open_folder", {
    title: "打开导出目录",
    description: "打开导出文件所在目录。参数：filePath 为导出文件路径。示例：{\"filePath\":\"C:/data/videos.csv\"}。",
    inputSchema: z.object({ filePath: z.string().trim().min(1).describe("导出文件路径") }),
    _meta: { ui: { resourceUri: resources.videos, visibility: ["app"] } },
  }, async ({ filePath }) => {
    try {
      const folderPath = await openExportFolder(filePath);
      return success("已打开文件保存目录。", { kind: "folder-opened", folderPath });
    } catch (error) {
      return failure(error);
    }
  });
}
