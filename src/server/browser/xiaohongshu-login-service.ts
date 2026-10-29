import type { HTTPResponse } from "puppeteer-core";
import { appStore } from "../store.js";
import { parseXiaohongshuProfile } from "../platform/xiaohongshu-parsers.js";
import { xiaohongshuAdapter } from "../platform/xiaohongshu-adapter.js";
import { browserManager } from "./browser-manager.js";
import { endpointPatterns, urlMatches } from "./selectors.js";

const LOGIN_TIMEOUT_MS = 5 * 60_000;

export interface XiaohongshuLoginResult {
  platform: "xiaohongshu";
  profile: ReturnType<typeof parseXiaohongshuProfile>;
  cookieCount: number;
}

class XiaohongshuLoginService {
  private active?: Promise<XiaohongshuLoginResult>;

  async begin(): Promise<XiaohongshuLoginResult> {
    if (this.active) return this.active;
    const task = this.waitForProfile();
    this.active = task;
    try {
      return await task;
    } finally {
      if (this.active === task) this.active = undefined;
    }
  }

  private async waitForProfile(): Promise<XiaohongshuLoginResult> {
    const page = await browserManager.getPage();
    await browserManager.showPage(page);
    return new Promise<XiaohongshuLoginResult>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finishReject(new Error("等待小红书登录超时，请重新执行 xiaohongshu.get_cookie")), LOGIN_TIMEOUT_MS);
      const cleanup = (): void => {
        clearTimeout(timer);
        page.off("response", onResponse);
        page.off("close", onClose);
      };
      const finishReject = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onClose = (): void => finishReject(new Error("小红书浏览器页面已关闭，请重新执行 xiaohongshu.get_cookie"));
      const onResponse = (response: HTTPResponse): void => {
        if (settled || !urlMatches(response.url(), endpointPatterns.xiaohongshuUserProfile)) return;
        // The profile endpoint also produces an OPTIONS preflight response.
        // Its body is intentionally unavailable in Chromium, so it must not
        // be treated as a failed login response.
        const request = response.request();
        if (request.method().toUpperCase() === "OPTIONS" || response.status() === 204) return;
        void (async () => {
          try {
            if (response.status() >= 400) return;
            let body: string;
            try {
              body = await response.text();
            } catch {
              // A response can disappear while the page navigates. It is not
              // a login failure; keep listening for the next real profile
              // response until the login timeout or page close.
              return;
            }
            const profile = parseXiaohongshuProfile(body);
            if (!profile) return;
            const browser = browserManager.getOpenBrowser();
            if (!browser) return finishReject(new Error("小红书浏览器已关闭，请重新执行登录"));
            const cookies = (await browser.defaultBrowserContext().cookies())
              .filter((cookie) => cookie.domain.includes("xiaohongshu.com") || cookie.domain.includes("xhscdn.com"));
            const cookieHeader = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
            await appStore.savePlatformAccount("xiaohongshu", { ...profile }, cookieHeader, await browser.userAgent());
            settled = true;
            cleanup();
            resolve({ platform: "xiaohongshu", profile, cookieCount: cookies.length });
          } catch (error) {
            finishReject(error instanceof Error ? error : new Error(String(error)));
          }
        })();
      };
      page.on("response", onResponse);
      page.once("close", onClose);
      void page.goto(xiaohongshuAdapter.homepage, { waitUntil: "domcontentloaded" }).catch((error) => finishReject(error instanceof Error ? error : new Error(String(error))));
    });
  }
}

export const xiaohongshuLoginService = new XiaohongshuLoginService();
