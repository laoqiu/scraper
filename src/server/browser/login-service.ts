import type { HTTPResponse, Page } from "puppeteer-core";
import { browserManager } from "./browser-manager.js";
import { parseSelfProfile } from "../parsers.js";
import { appStore } from "../store.js";
import type { LoginState } from "../types.js";

const LOGIN_URL = "https://www.douyin.com/";
const PROFILE_SELF_URL = "https://www.douyin.com/aweme/v1/web/user/profile/self/";
const QR_CONNECT_URL = "https://login.douyin.com/passport/web/check_qrconnect/";
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const ONE_CLICK_CHECK_INTERVAL_MS = 1_000;

function isProfileResponse(response: HTTPResponse): boolean {
  try {
    const url = new URL(response.url());
    return url.origin === "https://www.douyin.com" && url.pathname === new URL(PROFILE_SELF_URL).pathname;
  } catch {
    return false;
  }
}

function isQRConnectResponse(response: HTTPResponse): boolean {
  try {
    const url = new URL(response.url());
    return url.origin === "https://login.douyin.com" && url.pathname === new URL(QR_CONNECT_URL).pathname;
  } catch {
    return false;
  }
}

class LoginService {
  private activeLogin?: Promise<LoginState>;

  async begin(): Promise<LoginState> {
    await appStore.initialize();
    // The explicit browser mode is controlled only by douyin.set_headless.
    // An explicit login request always opens/reuses the browser in that mode.
    const page = await browserManager.getPage();
    await browserManager.showPage(page);

    // Reopening while an attempt is pending reuses the same five-minute task,
    // but refreshes the visible page so the profile request is emitted again.
    if (this.activeLogin) {
      await this.navigateToLogin(page);
      return this.activeLogin;
    }

    const attempt = this.waitForNetworkLogin(page);
    this.activeLogin = attempt;
    try {
      return await attempt;
    } finally {
      if (this.activeLogin === attempt) this.activeLogin = undefined;
    }
  }

  async prepareSession(): Promise<boolean> {
    await appStore.initialize();
    const account = await appStore.loadLoginAccount();
    if (account?.status !== 1) {
      await appStore.update({
        login: {
          status: account?.status === 2 ? "expired" : "missing",
          message: account?.status === 2 ? "登录会话已失效，请重新登录" : "未找到登录状态，请先执行抖音登录",
          updatedAt: new Date().toISOString(),
        },
      });
      return false;
    }
    // The SQLite account row is the local source of truth. Do not launch a browser just
    // to re-check its cookies; API responses will invalidate the account when
    // the persisted session is actually rejected.
    return true;
  }

  async invalidate(message = "登录会话已失效，请重新登录"): Promise<LoginState> {
    const state: LoginState = {
      status: "expired",
      message,
      updatedAt: new Date().toISOString(),
    };
    await appStore.markLoginAccountInvalid();
    await appStore.update({ login: state });
    return state;
  }

  private waitForNetworkLogin(initialPage: Page): Promise<LoginState> {
    return new Promise<LoginState>((resolve, reject) => {
      let activePage = initialPage;
      let settled = false;
      let processing = false;
      let loginInvalidated = false;
      let oneClickTimer: ReturnType<typeof setInterval> | undefined;
      const stopOneClickWatch = (): void => {
        if (!oneClickTimer) return;
        clearInterval(oneClickTimer);
        oneClickTimer = undefined;
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        stopOneClickWatch();
        activePage.off("response", onResponse);
        activePage.off("close", onClose);
      };
      const fail = async (message: string): Promise<void> => {
        if (settled) return;
        settled = true;
        cleanup();
        const state: LoginState = {
          status: "error",
          message,
          updatedAt: new Date().toISOString(),
        };
        await appStore.update({ login: state });
        reject(new Error(message));
      };
      const onClose = (): void => {
        void fail("登录窗口已关闭，请重新执行登录");
      };
      const onResponse = (response: HTTPResponse): void => {
        if (settled) return;
        if (isQRConnectResponse(response)) {
          stopOneClickWatch();
          if (!loginInvalidated) {
            loginInvalidated = true;
            void (async () => {
              try {
                await appStore.markLoginAccountInvalid();
                await appStore.update({
                  login: {
                    status: "expired",
                    message: "登录状态已失效，请通过 douyin.set_headless 设置 headless=false 后重新登录",
                    updatedAt: new Date().toISOString(),
                  },
                });
              } catch (error) {
                console.warn("[douyin] login invalidation failed", error);
              }
            })();
          }
          return;
        }
        if (processing || !isProfileResponse(response)) return;
        processing = true;
        void (async () => {
          try {
            const account = parseSelfProfile(await response.text());
            if (!account) return;
            const browser = browserManager.getOpenBrowser();
            if (!browser) {
              await fail("登录窗口已关闭，请重新执行登录");
              return;
            }
            const cookies = (await browser.defaultBrowserContext().cookies())
              .filter((cookie) => cookie.domain.includes("douyin.com"));
            const cookieHeader = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
            const userAgent = await browser.userAgent();
            await appStore.saveLoginAccount(account, cookieHeader, userAgent);
            await appStore.setCaptchaDetected(false);
            const state: LoginState = {
              status: "authenticated",
              message: "已成功获取登录状态",
              updatedAt: new Date().toISOString(),
              cookieCount: cookies.length,
              account,
            };
            await appStore.update({ login: state });
            if (settled) return;
            settled = true;
            cleanup();
            resolve(state);
          } catch (error) {
            console.warn("[douyin] profile response parse failed", error);
          } finally {
            processing = false;
          }
        })();
      };
      const timer = setTimeout(() => {
        void fail("等待抖音登录超时，请重新执行登录");
      }, LOGIN_TIMEOUT_MS);

      const checkOneClickLogin = async (): Promise<void> => {
        if (settled || loginInvalidated || activePage.isClosed()) return;
        try {
          const button = await activePage.$("#douyin_login_comp_btn_id");
          if (!button) return;
          const label = await button.evaluate((element) => element.textContent?.trim() ?? "");
          if (label !== "一键登录") return;
          stopOneClickWatch();
          await button.click();
        } catch (error) {
          if (!activePage.isClosed()) console.warn("[douyin] one-click login failed", error);
        }
      };

      const startOneClickWatch = (): void => {
        if (oneClickTimer || settled || loginInvalidated) return;
        oneClickTimer = setInterval(() => {
          void checkOneClickLogin();
        }, ONE_CLICK_CHECK_INTERVAL_MS);
        void checkOneClickLogin();
      };

      activePage.on("response", onResponse);
      activePage.once("close", onClose);
      void appStore.update({
        login: {
          status: "waiting",
          message: "等待登录，请在浏览器中完成操作",
          updatedAt: new Date().toISOString(),
        },
      }).then(() => this.navigateToLogin(activePage)).then(() => {
        startOneClickWatch();
      }).catch((error) => {
        void fail(error instanceof Error ? error.message : String(error));
      });
    });
  }

  private async navigateToLogin(page: Page): Promise<void> {
    await page.bringToFront();
    if (page.url().includes("douyin.com")) {
      await page.reload({ waitUntil: "load" });
      return;
    }
    await page.goto(LOGIN_URL, { waitUntil: "load" });
  }

}

export const loginService = new LoginService();
