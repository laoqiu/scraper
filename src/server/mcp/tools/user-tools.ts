import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { douyinCollector } from "../../browser/index.js";
import { appStore } from "../../store.js";
import type { DouyinUser, UserDetailInput } from "../../types.js";
import { resources } from "../app-resources.js";
import { failure, success, userCollectionSummary, userDetailStructuredSummary, usersStructuredSummary } from "../responses.js";
import { userFiltersInput, userPayload } from "../schemas.js";
import { registerScraperTool } from "../register-tool.js";

export function registerUserTools(server: McpServer, uiEnabled: boolean): void {
  registerScraperTool(server, uiEnabled, "douyin.search_users", {
    title: "采集抖音用户",
    description: "按关键词搜索抖音用户。参数：keyword 可选字符串，省略时只打开用户搜索页面；maxPages 可选整数，默认 10；filters 可选对象或 JSON 字符串，followerCount 可选 all/under-1000/1000-1w/1w-10w/10w-100w/over-100w，userType 可选 all/ordinary/enterprise/personal。示例：{\"keyword\":\"人工智能\",\"maxPages\":5,\"filters\":{\"followerCount\":\"1w-10w\"}}。返回采集页数和用户数量摘要。",
    inputSchema: z.object({
      keyword: z.string().trim().min(1, "keyword 不能为空；如果只打开页面，请传入空对象 {}").optional().describe("搜索关键词；省略时只打开用户搜索页面"),
      maxPages: z.coerce.number().int().min(1).max(50).default(10).describe("最多采集页数，默认 10"),
      filters: userFiltersInput,
    }).strict(),
    _meta: { ui: { resourceUri: resources.users } },
  }, async ({ keyword, maxPages, filters }) => {
    try {
      if (!keyword) return success("已打开用户搜索页面。", { kind: "page", page: "user-search" });
      const result = await douyinCollector.users({ keyword, maxPages, filters });
      return success(userCollectionSummary(result), usersStructuredSummary(result));
    } catch (error) {
      return failure(error);
    }
  });

  registerScraperTool(server, uiEnabled, "douyin.collect_user_videos", {
    title: "采集用户作品",
    description: "采集指定抖音用户的作品。参数：secUid 必填，用户列表中的 secUid 或 sec_uid；maxPages 可选整数，默认 10。示例：{\"secUid\":\"MS4wLjABAAAA...\",\"maxPages\":3}。返回用户信息、作品页数和作品数量摘要。",
    inputSchema: z.object({
      secUid: z.string().trim().min(1, "secUid 不能为空").describe("用户 secUid"),
      maxPages: z.coerce.number().int().min(1).max(50).default(10).describe("最多采集页数，默认 10"),
    }).strict(),
    _meta: { ui: { resourceUri: resources.userDetail } },
  }, async ({ secUid, maxPages }) => {
    try {
      const result = await douyinCollector.userVideos({ secUid, maxPages } satisfies UserDetailInput);
      return success(`已采集用户作品：${result.items.length} 条，共 ${result.pages ?? 0} 页。`, userDetailStructuredSummary(result));
    } catch (error) {
      return failure(error);
    }
  });

  registerScraperTool(server, uiEnabled, "state.save_users", {
    title: "导出选中的抖音用户",
    description: "将用户对象列表导出为 CSV。参数：users 为用户对象数组，字段格式见参数 schema。返回文件地址。",
    inputSchema: z.object({ users: z.array(userPayload) }),
    _meta: { ui: { resourceUri: resources.users, visibility: ["app"] } },
  }, async ({ users }) => {
    try {
      const filePath = await appStore.exportUsers(users as DouyinUser[]);
      return success(`当前导出数据 ${users.length} 条：\n文件地址：${filePath}`, { kind: "users-export", count: users.length, filePath });
    } catch (error) {
      return failure(error);
    }
  });

  registerScraperTool(server, uiEnabled, "state.select_user", {
    title: "选择抖音用户",
    description: "保存当前选择的用户对象。参数：用户对象，字段格式见参数 schema。",
    inputSchema: userPayload,
    _meta: { ui: { resourceUri: resources.users, visibility: ["app"] } },
  }, async (user) => {
    await appStore.update({ currentUser: user });
    return success(`已选择创作者 ${user.nickname}。`, { kind: "state", selectedUserId: user.uid });
  });
}
