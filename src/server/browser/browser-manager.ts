import path from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { addExtra } from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { findBrowserExecutable } from "./browser-executable.js";
import { appStore } from "../store.js";
import type { BrowserDependencyState } from "../types.js";
import { getPlatformAdapter } from "../platform/adapters.js";

const BROWSER_WINDOW_WIDTH = 1280;
const BROWSER_WINDOW_HEIGHT = 820;
const BROWSER_PROFILE_NAME = "Default";
const CAPTCHA_POLL_INTERVAL_MS = 5_000;

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class BrowserManager {
  // puppeteer-extra 3.x still requires the removed createBrowserFetcher API.
  // Supply an explicit adapter and reject that API to keep downloads disabled.
  private readonly launcher = addExtra({
    connect: puppeteer.connect.bind(puppeteer),
    defaultArgs: puppeteer.defaultArgs.bind(puppeteer),
    executablePath: puppeteer.executablePath.bind(puppeteer),
    launch: puppeteer.launch.bind(puppeteer),
    createBrowserFetcher: () => { throw new Error("浏览器下载已禁用，请使用本机已安装的浏览器。"); },
  }).use(StealthPlugin());
  private browser?: Browser;
  private browserPromise?: Promise<Browser>;
  private browserPreparationPromise?: Promise<void>;
  private browserDependency: BrowserDependencyState = {
    ready: false,
    status: "idle",
    message: "浏览器依赖尚未检查",
  };
  private page?: Page;
  private pagePromise?: Promise<Page>;
  private collectionQueue: Promise<unknown> = Promise.resolve();
  private captchaTimer?: ReturnType<typeof setInterval>;
  private captchaCheck?: Promise<void>;

  async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    await this.prepareBrowser();
    if (!this.browserDependency.ready) {
      throw this.browserDependencyNotReadyError();
    }
    if (this.browserPromise) return this.browserPromise;
    this.browserPromise = this.launchBrowser().finally(() => {
      this.browserPromise = undefined;
    });
    return this.browserPromise;
  }

  getOpenBrowser(): Browser | undefined {
    return this.browser?.connected ? this.browser : undefined;
  }

  getBrowserDependencyState(): BrowserDependencyState {
    return structuredClone(this.browserDependency);
  }

  prepareBrowser(): Promise<void> {
    if (this.browserDependency.ready) return Promise.resolve();
    if (this.browserPreparationPromise) return this.browserPreparationPromise;

    this.browserDependency = {
      ready: false,
      status: "checking",
      message: "正在查找本机浏览器",
      updatedAt: new Date().toISOString(),
    };
    const preparation = (async () => {
      try {
        const binaryPath = await findBrowserExecutable();
        this.browserDependency = {
          ready: true,
          status: "ready",
          message: "本机浏览器已就绪",
          binaryPath,
          updatedAt: new Date().toISOString(),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.browserDependency = {
          ready: false,
          status: "error",
          message: "本机浏览器不可用",
          error: message,
          updatedAt: new Date().toISOString(),
        };
      }
    })();
    this.browserPreparationPromise = preparation.finally(() => {
      if (this.browserPreparationPromise === wrappedPreparation) {
        this.browserPreparationPromise = undefined;
      }
    });
    const wrappedPreparation = this.browserPreparationPromise;
    return wrappedPreparation;
  }

  private async launchBrowser(): Promise<Browser> {
    if (!this.browserDependency.ready) {
      throw this.browserDependencyNotReadyError();
    }
    await appStore.initialize();
    const browser = await this.launcher.launch({
      executablePath: this.browserDependency.binaryPath!,
      userDataDir: path.resolve(appStore.browserProfile),
      headless: false,
      args: [
        `--profile-directory=${BROWSER_PROFILE_NAME}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-mode",
        "--disable-backgrounding-occluded-windows",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        `--window-size=${BROWSER_WINDOW_WIDTH},${BROWSER_WINDOW_HEIGHT}`,
      ],
      defaultViewport: null,
    });
    return this.adoptBrowser(browser);
  }

  private browserDependencyNotReadyError(): Error {
    return new Error(this.browserDependency.error ?? "本机浏览器尚未就绪，请调用 state.get 检查浏览器路径。");
  }

  private adoptBrowser(browser: Browser): Browser {
    this.browser = browser;
    this.startCaptchaMonitor();
    browser.on("disconnected", () => {
      if (this.browser === browser) this.browser = undefined;
      this.page = undefined;
      this.pagePromise = undefined;
      this.stopCaptchaMonitor();
    });
    return browser;
  }

  async getPage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    if (this.pagePromise) return this.pagePromise;
    this.pagePromise = this.claimPage().finally(() => {
      this.pagePromise = undefined;
    });
    return this.pagePromise;
  }

  async showPage(page: Page): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await page.bringToFront();
        break;
      } catch (error) {
        if (!(error instanceof Error) || !/detached frame|frame .* detached/i.test(error.message) || attempt === 1) throw error;
        await delay(350);
      }
    }
    // `Page.bringToFront` activates the tab, but Chromium may leave the
    // visible browser window minimized or behind another window. Restore the
    // DevTools window as well so background-page throttling does not prevent
    // Douyin from loading the next page of results.
    try {
      const client = await page.createCDPSession();
      try {
        const { windowId } = await client.send("Browser.getWindowForTarget");
        await client.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
      } finally {
        await client.detach().catch(() => undefined);
      }
    } catch {
      // Some existing/remote browser connections do not expose Browser domain
      // window controls; tab activation above is still useful in that case.
    }
  }

  private currentSearchUrl(): string | undefined {
    const state = appStore.snapshot();
    const videoPlatform = state.lastVideoSearch?.platform ?? "douyin";
    const userPlatform = state.lastUserSearch?.platform ?? "douyin";
    const videoAdapter = getPlatformAdapter(videoPlatform);
    const userAdapter = getPlatformAdapter(userPlatform);
    const detailSecUid = state.userDetailProgress?.secUid || state.lastUserDetail?.secUid;
    if (state.userDetailProgress?.status === "collecting" && detailSecUid) {
      return `https://www.douyin.com/user/${encodeURIComponent(detailSecUid)}?from_tab_name=main`;
    }
    if (state.videoProgress.status === "collecting" && state.lastVideoSearch?.keyword) {
      return videoAdapter.videoSearchUrl(state.lastVideoSearch.keyword);
    }
    if (state.userProgress.status === "collecting" && state.lastUserSearch?.keyword) {
      return userAdapter.userSearchUrl(state.lastUserSearch.keyword);
    }

    const recent = [
      state.lastVideos?.collectedAt ? {
        at: state.lastVideos.collectedAt,
        url: state.lastVideoSearch?.keyword
          ? videoAdapter.videoSearchUrl(state.lastVideoSearch.keyword)
          : undefined,
      } : undefined,
      state.lastUsers?.collectedAt ? {
        at: state.lastUsers.collectedAt,
        url: state.lastUserSearch?.keyword
          ? userAdapter.userSearchUrl(state.lastUserSearch.keyword)
          : undefined,
      } : undefined,
      state.lastUserDetail?.collectedAt ? {
        at: state.lastUserDetail.collectedAt,
        url: detailSecUid
          ? `https://www.douyin.com/user/${encodeURIComponent(detailSecUid)}?from_tab_name=main`
          : undefined,
      } : undefined,
    ].filter((item): item is { at: string; url: string } => Boolean(item?.url));
    recent.sort((left, right) => right.at.localeCompare(left.at));
    if (recent[0]) return recent[0].url;

    if (state.lastVideoSearch?.keyword) {
      return videoAdapter.videoSearchUrl(state.lastVideoSearch.keyword);
    }
    if (state.lastUserSearch?.keyword) {
      return userAdapter.userSearchUrl(state.lastUserSearch.keyword);
    }
    return undefined;
  }

  async reloadPage(): Promise<boolean> {
    // Do not rely only on the cached page handle. The browser can remain
    // connected while the active tab is replaced or the handle is cleared
    // during captcha handling. getPage() reconnects to the existing browser
    // or launches it when necessary.
    const page = await this.getPage();
    if (page.url() === "about:blank") {
      const currentUrl = this.currentSearchUrl();
      if (currentUrl) {
        await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      }
    }
    await this.showPage(page);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
    await appStore.setCaptchaDetected(false);
    return true;
  }

  private async claimPage(): Promise<Page> {
    const browser = await this.getBrowser();
    const pages = (await browser.pages()).filter((candidate) => !candidate.isClosed());
    const page = pages[0] ?? await browser.newPage();
    page.setDefaultTimeout(12_000);
    page.setDefaultNavigationTimeout(45_000);
    this.page = page;
    page.once("close", () => {
      if (this.page === page) this.page = undefined;
    });
    return page;
  }

  async runCollection<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.collectionQueue.catch(() => undefined);
    let release!: () => void;
    this.collectionQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    this.browserPromise = undefined;
    this.page = undefined;
    this.pagePromise = undefined;
    this.stopCaptchaMonitor();
    if (browser?.connected) await browser.close().catch(() => undefined);
  }

  private startCaptchaMonitor(): void {
    if (this.captchaTimer) return;
    this.captchaTimer = setInterval(() => {
      void this.checkCaptcha();
    }, CAPTCHA_POLL_INTERVAL_MS);
    void this.checkCaptcha();
  }

  private stopCaptchaMonitor(): void {
    if (!this.captchaTimer) return;
    clearInterval(this.captchaTimer);
    this.captchaTimer = undefined;
    this.captchaCheck = undefined;
  }

  private async checkCaptcha(): Promise<void> {
    if (this.captchaCheck) return this.captchaCheck;
    this.captchaCheck = (async () => {
      const browser = this.browser;
      if (!browser?.connected) return;
      try {
        const pages = (await browser.pages()).filter((candidate) => !candidate.isClosed());
        const page = this.page && !this.page.isClosed() ? this.page : pages[0];
        const detected = page ? await page.evaluate(() => {
          const captcha = document.querySelector<HTMLElement>("div#captcha_container");
          if (!captcha) return false;
          const style = window.getComputedStyle(captcha);
          const rect = captcha.getBoundingClientRect();
          return style.display !== "none"
            && style.visibility !== "hidden"
            && style.visibility !== "collapse"
            && style.opacity !== "0"
            && rect.width > 0
            && rect.height > 0
            && captcha.getClientRects().length > 0;
        }).catch(() => false) : false;
        await appStore.setCaptchaDetected(detected);
      } catch {
        // A page can disappear while the shared browser is being replaced.
      }
    })().finally(() => {
      this.captchaCheck = undefined;
    });
    return this.captchaCheck;
  }
}

export const browserManager = new BrowserManager();
