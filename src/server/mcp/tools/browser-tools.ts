import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { browserManager, loginService } from "../../browser/index.js";
import { appStore } from "../../store.js";
import { resources } from "../app-resources.js";
import { failure, success } from "../responses.js";
import { registerScraperTool } from "../register-tool.js";

export function registerBrowserTools(server: McpServer, uiEnabled: boolean): void {
  registerScraperTool(server, uiEnabled, "douyin.get_cookie", {
    title: "抖音登录",
    description: "登录抖音账号并返回账号摘要。无参数，示例：{}。",
    inputSchema: z.object({}),
    _meta: { ui: { resourceUri: resources.login } },
  }, async () => {
    try {
      const login = await loginService.begin();
      const account = login.account!;
      const publicAccount = {
        secUid: account.secUid,
        douyinId: account.douyinId,
        nickname: account.nickname,
        signature: account.signature,
        avatarUrl: account.avatarUrl,
        followerCount: account.followerCount,
        followingCount: account.followingCount,
        videoCount: account.videoCount,
      };
      const text = [
        "用户登录成功", "", `昵称：${account.nickname || "-"}`,
        `关注：${account.followingCount}`, `粉丝：${account.followerCount}`,
        "", "你可以继续以下操作：", "- 根据关键词搜索视频", "- 根据关键词搜索账号",
      ].join("\n");
      return success(text, { kind: "login", login: { ...login, account: publicAccount }, account: publicAccount });
    } catch (error) {
      return failure(error);
    }
  });

  registerScraperTool(server, uiEnabled, "state.reload_browser_page", {
    title: "刷新抖音浏览器页面",
    description: "刷新当前抖音浏览器页面。无参数，示例：{}。返回是否刷新成功。",
    inputSchema: z.object({}).strict(),
    _meta: { ui: { resourceUri: resources.videos, visibility: ["app"] } },
  }, async () => {
    try {
      const reloaded = await browserManager.reloadPage();
      return success(reloaded ? "浏览器页面已刷新。" : "当前没有可刷新的浏览器页面。", { kind: "browser-reload", reloaded });
    } catch (error) {
      return failure(error);
    }
  });

  registerScraperTool(server, uiEnabled, "state.acknowledge_captcha", {
    title: "确认验证码已处理",
    description: "确认用户已完成验证码处理，不刷新浏览器页面。无参数，示例：{}。",
    inputSchema: z.object({}).strict(),
    _meta: { ui: { resourceUri: resources.videos, visibility: ["app"] } },
  }, async () => {
    await appStore.setCaptchaDetected(false);
    return success("已确认验证码处理完成，继续使用当前页面。", { kind: "captcha-acknowledged" });
  });
}
