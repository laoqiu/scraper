import { randomUUID } from "node:crypto";
import type { HTTPResponse, Page } from "puppeteer-core";
import { parseXiaohongshuDetailVideo, parseXiaohongshuFeedVideo, parseXiaohongshuNotesPage, parseXiaohongshuUsersPage } from "../platform/xiaohongshu-parsers.js";
import { xiaohongshuAdapter } from "../platform/xiaohongshu-adapter.js";
import { appStore } from "../store.js";
import type { DouyinUser, DouyinVideo, UserCollectionResult, UserDetailCollectionResult, UserDetailInput, UserFilters, VideoCollectionResult, VideoSearchInput, UserSearchInput } from "../types.js";
import { browserManager } from "./browser-manager.js";
import { applyXiaohongshuVideoFilters, clickXiaohongshuUserTab, hasXiaohongshuVideoFilters, requireXiaohongshuLogin } from "./xiaohongshu-interaction.js";
import { endpointPatterns, urlMatches } from "./selectors.js";
import { scrollForMore, sleep, FIRST_PAGE_TIMEOUT, captureFailure } from "./interaction.js";
import { videoProxy } from "./video-proxy.js";

const PLAYBACK_TIMEOUT_MS = 45_000;
const USER_NOTES_FIRST_PAGE_TIMEOUT_MS = 120_000;
const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

const DEFAULT_USER_FILTERS: UserFilters = { followerCount: "all", userType: "all" };

interface ActiveVideoSearch {
  jobId: string;
  key: string;
  page: Page;
  input: VideoSearchInput;
  items: Map<string, DouyinVideo>;
  pending: Set<Promise<void>>;
  handleResponse: (response: HTTPResponse) => void;
  captureEnabled: boolean;
  firstPage: Promise<void>;
  firstPageResolved: boolean;
  loadedPages: number;
  hasMore: boolean;
  terminal: boolean;
}

interface ActiveUserSearch {
  jobId: string;
  key: string;
  page: Page;
  input: UserSearchInput;
  items: Map<string, DouyinUser>;
  pending: Set<Promise<void>>;
  handleResponse: (response: HTTPResponse) => void;
  firstPage: Promise<void>;
  firstPageResolved: boolean;
  loadedPages: number;
  hasMore: boolean;
  terminal: boolean;
}

interface ActiveUserNotes {
  jobId: string;
  page: Page;
  input: UserDetailInput;
  user?: DouyinUser;
  profileStats?: UserDetailCollectionResult["profileStats"];
  items: Map<string, DouyinVideo>;
  pending: Set<Promise<void>>;
  handleResponse: (response: HTTPResponse) => void;
  firstPage: Promise<void>;
  firstPageResolved: boolean;
  responseReceived: boolean;
  loadedPages: number;
  hasMore: boolean;
  terminal: boolean;
  filePath?: string;
}

function parseXiaohongshuCount(value: string): number | undefined {
  const match = value.replaceAll(",", "").match(/([\d.]+)\s*(万|亿)?/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  return Math.round(amount * (match[2] === "亿" ? 100_000_000 : match[2] === "万" ? 10_000 : 1));
}

function parseXiaohongshuProfileStats(blocks: string[]): UserDetailCollectionResult["profileStats"] {
  const read = (label: string): number | undefined => {
    for (const block of blocks) {
      const compact = block.replace(/\s+/g, " ").trim();
      const index = compact.indexOf(label);
      if (index < 0) continue;
      const number = "([\\d,.]+\\s*(?:万|亿)?)";
      const before = compact.slice(0, index).match(new RegExp(`${number}$`))?.[1];
      const after = compact.slice(index + label.length).match(new RegExp(`^\\s*${number}`))?.[1];
      const parsed = parseXiaohongshuCount(before ?? "") ?? parseXiaohongshuCount(after ?? "");
      if (parsed !== undefined) return parsed;
    }
    // Some layouts flatten the metric groups into one text node. In that case
    // use line adjacency from innerText as a fallback.
    const lines = blocks.join("\n").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const index = lines.findIndex((line) => line.includes(label));
    if (index < 0) return undefined;
    return parseXiaohongshuCount(lines[index + 1] ?? "") ?? parseXiaohongshuCount(lines[index - 1] ?? "");
  };
  const stats = {
    followingCount: read("关注"),
    followerCount: read("粉丝"),
    likesAndCollectsCount: read("获赞与收藏"),
  };
  return Object.values(stats).some((value) => value !== undefined) ? stats : undefined;
}

async function readXiaohongshuProfileStats(page: Page): Promise<UserDetailCollectionResult["profileStats"]> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const blocks = await page.evaluate(() => {
      const root = document.querySelector(".user-interactions");
      if (!root) return [];
      const children = Array.from(root.children).map((child) => (child as HTMLElement).innerText.trim()).filter(Boolean);
      return children.length ? children : [(root as HTMLElement).innerText.trim()].filter(Boolean);
    }).catch((): string[] => []);
    const stats = parseXiaohongshuProfileStats(blocks);
    if (stats) return stats;
    if (attempt < 24) await sleep(400);
  }
  return undefined;
}

async function bodyOf(response: HTTPResponse): Promise<string> {
  if (response.status() === 401 || response.status() === 403) {
    await appStore.markPlatformAccountInvalid("xiaohongshu");
    return "";
  }
  if (response.status() >= 400) return "";
  try {
    return await response.text();
  } catch {
    return "";
  }
}

export class XiaohongshuCollector {
  private activeVideos?: ActiveVideoSearch;
  private activeUsers?: ActiveUserSearch;
  private activeUserNotes?: ActiveUserNotes;

  isUserSearchRunning(): boolean {
    return Boolean(this.activeUsers && !this.activeUsers.terminal && !this.activeUsers.page.isClosed());
  }

  clear(): void {
    if (this.activeVideos) {
      this.activeVideos.terminal = true;
      this.activeVideos.page.off("response", this.activeVideos.handleResponse);
      this.activeVideos = undefined;
    }
    if (this.activeUsers) {
      this.activeUsers.terminal = true;
      this.activeUsers.page.off("response", this.activeUsers.handleResponse);
      this.activeUsers = undefined;
    }
    if (this.activeUserNotes) {
      this.activeUserNotes.terminal = true;
      this.activeUserNotes.page.off("response", this.activeUserNotes.handleResponse);
      this.activeUserNotes = undefined;
    }
  }

  async videos(input: VideoSearchInput): Promise<VideoCollectionResult> {
    return browserManager.runCollection(async () => {
      const normalized: VideoSearchInput = { ...input, platform: "xiaohongshu" };
      const existing = this.activeVideos;
      if (existing && existing.key === this.videoKey(normalized) && !existing.page.isClosed() && normalized.maxPages > existing.loadedPages) {
        return this.extendVideos(existing, normalized.maxPages);
      }
      this.clear();
      await requireXiaohongshuLogin();
      await appStore.update({
        lastVideos: undefined,
        lastVideoSearch: normalized,
        videoProgress: { status: "collecting", pages: 0, maxPages: normalized.maxPages, itemCount: 0 },
      });
      const page = await browserManager.getPage();
      const items = new Map<string, DouyinVideo>();
      const pending = new Set<Promise<void>>();
      let resolveFirstPage!: () => void;
      const active: ActiveVideoSearch = {
        jobId: randomUUID(),
        key: this.videoKey(normalized),
        page,
        input: normalized,
        items,
        pending,
        handleResponse: () => undefined,
        captureEnabled: !hasXiaohongshuVideoFilters(normalized),
        firstPage: new Promise<void>((resolve) => { resolveFirstPage = resolve; }),
        firstPageResolved: false,
        loadedPages: 0,
        hasMore: true,
        terminal: false,
      };
      const handleResponse = (response: HTTPResponse): void => {
        if (!active.captureEnabled || !urlMatches(response.url(), endpointPatterns.xiaohongshuNotes)) return;
        const task = bodyOf(response).then(async (body) => {
          const parsed = parseXiaohongshuNotesPage(body);
          for (const item of parsed.items) items.set(item.id, item);
          if (parsed.hasMore === false) active.hasMore = false;
          await this.publishVideos(active, "collecting");
          if (items.size > 0 && !active.firstPageResolved) {
            active.firstPageResolved = true;
            resolveFirstPage();
          }
        }).finally(() => pending.delete(task));
        pending.add(task);
      };
      active.handleResponse = handleResponse;
      this.activeVideos = active;
      page.on("response", handleResponse);
      try {
        await browserManager.showPage(page);
        await page.goto(xiaohongshuAdapter.videoSearchUrl(normalized.keyword), { waitUntil: "domcontentloaded" });
        await applyXiaohongshuVideoFilters(page, normalized, () => { active.captureEnabled = true; });
        await Promise.race([active.firstPage, sleep(FIRST_PAGE_TIMEOUT)]);
        if (items.size === 0) throw new Error("未获取到小红书笔记搜索结果");
        active.loadedPages = 1;
        return this.extendVideos(active, normalized.maxPages);
      } catch (error) {
        active.terminal = true;
        this.clear();
        await Promise.allSettled([...pending]);
        await this.publishVideos(active, "error", error instanceof Error ? error.message : String(error));
        await captureFailure(page, "xiaohongshu-video-collection-failed");
        throw error;
      }
    });
  }

  async users(input: UserSearchInput): Promise<UserCollectionResult> {
    return browserManager.runCollection(async () => {
      const normalized: UserSearchInput = { ...input, platform: "xiaohongshu", filters: DEFAULT_USER_FILTERS };
      const existing = this.activeUsers;
      if (existing && existing.key === this.userKey(normalized) && !existing.page.isClosed() && normalized.maxPages > existing.loadedPages) {
        return this.extendUsers(existing, normalized.maxPages);
      }
      this.clear();
      await requireXiaohongshuLogin();
      await appStore.update({
        lastUsers: undefined,
        lastUserSearch: normalized,
        userProgress: { status: "collecting", pages: 0, maxPages: normalized.maxPages, itemCount: 0 },
      });
      const page = await browserManager.getPage();
      const items = new Map<string, DouyinUser>();
      const pending = new Set<Promise<void>>();
      let resolveFirstPage!: () => void;
      const active: ActiveUserSearch = {
        jobId: randomUUID(),
        key: this.userKey(normalized),
        page,
        input: normalized,
        items,
        pending,
        handleResponse: () => undefined,
        firstPage: new Promise<void>((resolve) => { resolveFirstPage = resolve; }),
        firstPageResolved: false,
        loadedPages: 0,
        hasMore: true,
        terminal: false,
      };
      const handleResponse = (response: HTTPResponse): void => {
        if (!urlMatches(response.url(), endpointPatterns.xiaohongshuUsers)) return;
        const task = bodyOf(response).then(async (body) => {
          const parsed = parseXiaohongshuUsersPage(body);
          for (const item of parsed.items) items.set(item.uid, item);
          if (parsed.hasMore === false) active.hasMore = false;
          await this.publishUsers(active, "collecting");
          if (items.size > 0 && !active.firstPageResolved) {
            active.firstPageResolved = true;
            resolveFirstPage();
          }
        }).finally(() => pending.delete(task));
        pending.add(task);
      };
      active.handleResponse = handleResponse;
      this.activeUsers = active;
      page.on("response", handleResponse);
      try {
        await browserManager.showPage(page);
        await page.goto(xiaohongshuAdapter.userSearchUrl(normalized.keyword), { waitUntil: "domcontentloaded" });
        await clickXiaohongshuUserTab(page);
        await Promise.race([active.firstPage, sleep(FIRST_PAGE_TIMEOUT)]);
        if (items.size === 0) throw new Error("未获取到小红书用户搜索结果");
        active.loadedPages = 1;
        return this.extendUsers(active, normalized.maxPages);
      } catch (error) {
        active.terminal = true;
        this.clear();
        await Promise.allSettled([...pending]);
        await this.publishUsers(active, "error", error instanceof Error ? error.message : String(error));
        await captureFailure(page, "xiaohongshu-user-collection-failed");
        throw error;
      }
    });
  }

  async userNotes(input: UserDetailInput): Promise<UserDetailCollectionResult> {
    return browserManager.runCollection(async () => {
      const normalized: UserDetailInput = { ...input, platform: "xiaohongshu", maxPages: Math.min(10, input.maxPages) };
      const existing = this.activeUserNotes;
      if (existing && existing.input.secUid === normalized.secUid && !existing.page.isClosed()) {
        return this.extendUserNotes(existing, normalized.maxPages);
      }
      this.clear();
      await requireXiaohongshuLogin();
      await appStore.update({
        lastUserDetail: undefined,
        currentUser: undefined,
        userDetailProgress: { secUid: normalized.secUid, status: "collecting", pages: 0, maxPages: normalized.maxPages, itemCount: 0 },
      });
      const page = await browserManager.getPage();
      const items = new Map<string, DouyinVideo>();
      const pending = new Set<Promise<void>>();
      let resolveFirstPage!: () => void;
      const active: ActiveUserNotes = {
        jobId: randomUUID(), page, input: normalized, items, pending,
        handleResponse: () => undefined,
        firstPage: new Promise<void>((resolve) => { resolveFirstPage = resolve; }),
        firstPageResolved: false, responseReceived: false, loadedPages: 0, hasMore: true, terminal: false,
      };
      const handleResponse = (response: HTTPResponse): void => {
        if (!urlMatches(response.url(), endpointPatterns.xiaohongshuUserPosted)) return;
        const method = response.request().method().toUpperCase();
        if (method === "OPTIONS") return;
        active.responseReceived = true;
        console.error(`[scraper] xiaohongshu user_posted response method=${method} status=${response.status()} url=${response.url()}`);
        const task = bodyOf(response).then(async (body) => {
          const parsed = parseXiaohongshuNotesPage(body);
          for (const item of parsed.items) items.set(item.id, item);
          if (parsed.hasMore === false) active.hasMore = false;
          active.loadedPages = Math.max(1, active.loadedPages);
          console.error(`[scraper] xiaohongshu user_posted parsed bodyBytes=${body.length} pageItems=${parsed.items.length} totalItems=${items.size} hasMore=${parsed.hasMore ?? "unknown"}`);
          await this.publishUserNotes(active, "collecting");
          if (!active.firstPageResolved) {
            active.firstPageResolved = true;
            resolveFirstPage();
          }
        }).finally(() => pending.delete(task));
        pending.add(task);
      };
      active.handleResponse = handleResponse;
      this.activeUserNotes = active;
      page.on("response", handleResponse);
      console.error("[scraper] xiaohongshu user_posted listener attached before navigation");
      try {
        await browserManager.showPage(page);
        const token = normalized.xsecToken ? `?xsec_token=${encodeURIComponent(normalized.xsecToken)}&xsec_source=pc_search` : "";
        const targetUrl = `https://www.xiaohongshu.com/user/profile/${encodeURIComponent(normalized.secUid)}${token}`;
        console.error(`[scraper] xiaohongshu user notes navigate userId=${normalized.secUid} hasXsecToken=${Boolean(normalized.xsecToken)}`);
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: USER_NOTES_FIRST_PAGE_TIMEOUT_MS });
        active.profileStats = await readXiaohongshuProfileStats(page);
        await this.publishUserNotes(active, "collecting");
        await Promise.race([active.firstPage, sleep(USER_NOTES_FIRST_PAGE_TIMEOUT_MS)]);
        await Promise.all([...pending]);
        if (!active.responseReceived) throw new Error("等待小红书用户笔记接口响应超时；请确认用户主页已加载并重试");
        active.loadedPages = Math.max(1, active.loadedPages);
        return this.extendUserNotes(active, normalized.maxPages);
      } catch (error) {
        active.terminal = true;
        this.activeUserNotes = undefined;
        page.off("response", handleResponse);
        await Promise.allSettled([...pending]);
        await this.publishUserNotes(active, "error", error instanceof Error ? error.message : String(error));
        await captureFailure(page, "xiaohongshu-user-notes-failed");
        throw error;
      }
    });
  }

  async resolveVideoSource(videoId: string, xsecToken: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    if (!xsecToken.trim()) throw new Error("缺少小红书 xsec_token，无法打开笔记详情");
    console.error(`[scraper] xiaohongshu resolve video source videoId=${videoId} hasXsecToken=${Boolean(xsecToken)}`);
    await requireXiaohongshuLogin();
    const page = await browserManager.getPage();
    await browserManager.showPage(page);
    signal?.throwIfAborted();
    const detailUrl = `https://www.xiaohongshu.com/explore/${encodeURIComponent(videoId)}?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=pc_search&source=web_explore_feed`;

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        page.off("response", onResponse);
        page.off("close", onClose);
      };
      const finishReject = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const finishResolve = (playUrl: string): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(playUrl);
      };
      const onAbort = (): void => finishReject(new Error("获取视频地址已取消"));
      const onClose = (): void => finishReject(new Error("小红书浏览器页面已关闭，无法获取视频地址"));
      const resolvePlayback = (playUrl: string, source: string): void => {
        if (settled) return;
        console.error(`[scraper] xiaohongshu playback source videoId=${videoId} source=${source} url=${playUrl}`);
        finishResolve(playUrl);
      };
      const onResponse = (response: HTTPResponse): void => {
        const responseUrl = response.url();
        const matchesFeed = urlMatches(responseUrl, endpointPatterns.xiaohongshuFeed);
        if (responseUrl.includes("xiaohongshu.com/api/")) {
          console.error(`[scraper] xiaohongshu detail api status=${response.status()} matchedFeed=${matchesFeed} url=${responseUrl}`);
        }
        if (settled || !matchesFeed) return;
        if (response.request().method().toUpperCase() === "OPTIONS") return;
        console.error(`[scraper] xiaohongshu feed response videoId=${videoId} status=${response.status()} url=${responseUrl}`);
        void (async () => {
          const body = await bodyOf(response);
          if (!body) {
            console.error(`[scraper] xiaohongshu feed body unavailable videoId=${videoId} status=${response.status()}`);
            return;
          }
          const playUrl = parseXiaohongshuFeedVideo(body, videoId);
          if (!playUrl) {
            console.error(`[scraper] xiaohongshu playback source missing videoId=${videoId}`);
            return;
          }
          resolvePlayback(playUrl, "feed");
        })().catch((error) => finishReject(error instanceof Error ? error : new Error(String(error))));
      };

      timer = setTimeout(() => finishReject(new Error("等待小红书笔记视频地址超时")), PLAYBACK_TIMEOUT_MS);
      page.on("response", onResponse);
      page.once("close", onClose);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) { onAbort(); return; }
      console.error(`[scraper] xiaohongshu playback navigate from=${page.url()} to=${detailUrl}`);
      void page.goto(detailUrl, { waitUntil: "domcontentloaded" })
        .then(async (navigation) => {
          console.error(`[scraper] xiaohongshu playback navigation status=${navigation?.status() ?? "none"} url=${page.url()}`);
          for (let attempt = 0; attempt < 20 && !settled; attempt += 1) {
            const mediaV2 = await page.evaluate((noteId) => {
              const state = (window as unknown as {
                __INITIAL_STATE__?: {
                  note?: {
                    noteDetailMap?: Record<string, { note?: { video?: { mediaV2?: unknown } } }>;
                  };
                };
              }).__INITIAL_STATE__;
              return state?.note?.noteDetailMap?.[noteId]?.note?.video?.mediaV2;
            }, videoId).catch(() => undefined);
            const playUrl = parseXiaohongshuDetailVideo(mediaV2);
            if (playUrl) {
              await resolvePlayback(playUrl, "window.__INITIAL_STATE__.note.noteDetailMap");
              return;
            }
            if (attempt < 19) await sleep(250);
          }
          if (!settled) console.error(`[scraper] xiaohongshu detail mediaV2 missing videoId=${videoId}`);
        })
        .catch((error) => {
          console.error(`[scraper] xiaohongshu playback navigation failed url=${detailUrl}`, error);
          finishReject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  async playVideo(videoId: string, xsecToken: string): Promise<{ videoId: string; videoUrl: string }> {
    const playUrl = await this.resolveVideoSource(videoId, xsecToken);
    const account = await appStore.loadPlatformAccount("xiaohongshu");
    const videoUrl = await videoProxy.register(
      playUrl,
      account?.cookie ?? "",
      account?.user_agent || DEFAULT_USER_AGENT,
      { platform: "xiaohongshu", referer: xiaohongshuAdapter.homepage },
    );
    console.error(`[scraper] xiaohongshu playback proxy videoId=${videoId} url=${videoUrl} referer=${xiaohongshuAdapter.homepage}`);
    return { videoId, videoUrl };
  }

  private videoKey(input: VideoSearchInput): string {
    return JSON.stringify({ platform: "xiaohongshu", keyword: input.keyword, filters: input.filters });
  }

  private userKey(input: UserSearchInput): string {
    return JSON.stringify({ platform: "xiaohongshu", keyword: input.keyword });
  }

  private videoResult(active: ActiveVideoSearch): VideoCollectionResult {
    return {
      kind: "videos",
      jobId: active.jobId,
      platform: "xiaohongshu",
      keyword: active.input.keyword,
      filters: active.input.filters,
      items: [...active.items.values()],
      collectedAt: new Date().toISOString(),
      pages: active.loadedPages,
      hasMore: active.hasMore,
    };
  }

  private userResult(active: ActiveUserSearch): UserCollectionResult {
    return {
      kind: "users",
      jobId: active.jobId,
      platform: "xiaohongshu",
      keyword: active.input.keyword,
      filters: DEFAULT_USER_FILTERS,
      items: [...active.items.values()],
      collectedAt: new Date().toISOString(),
      pages: active.loadedPages,
      hasMore: active.hasMore,
    };
  }

  private async publishVideos(active: ActiveVideoSearch, status: "collecting" | "completed" | "error", message?: string): Promise<void> {
    if (status === "collecting" && active.terminal) return;
    const result = this.videoResult(active);
    await appStore.update({
      lastVideoSearch: active.input,
      lastVideos: result,
      videoProgress: { status, pages: Math.max(1, active.loadedPages), maxPages: active.input.maxPages, itemCount: result.items.length, message },
    });
  }

  private async publishUsers(active: ActiveUserSearch, status: "collecting" | "completed" | "error", message?: string): Promise<void> {
    if (status === "collecting" && active.terminal) return;
    const result = this.userResult(active);
    await appStore.update({
      lastUserSearch: active.input,
      lastUsers: result,
      userProgress: { status, pages: Math.max(1, active.loadedPages), maxPages: active.input.maxPages, itemCount: result.items.length, message },
    });
  }

  private userNotesResult(active: ActiveUserNotes): UserDetailCollectionResult {
    return {
      kind: "user-detail", jobId: active.jobId, secUid: active.input.secUid, user: active.user,
      items: [...active.items.values()], collectedAt: new Date().toISOString(), pages: active.loadedPages,
      hasMore: active.hasMore, platform: "xiaohongshu", filePath: active.filePath,
      profileStats: active.profileStats,
    };
  }

  private async publishUserNotes(active: ActiveUserNotes, status: "collecting" | "completed" | "error", message?: string): Promise<void> {
    if (status === "collecting" && active.terminal) return;
    const result = this.userNotesResult(active);
    await appStore.update({
      lastUserDetail: result,
      currentUser: active.user,
      userDetailProgress: { secUid: active.input.secUid, status, pages: Math.max(1, active.loadedPages), maxPages: active.input.maxPages, itemCount: result.items.length, message },
    });
  }

  private async extendUserNotes(active: ActiveUserNotes, targetPages: number): Promise<UserDetailCollectionResult> {
    active.terminal = false;
    active.input = { ...active.input, maxPages: Math.min(10, targetPages) };
    await this.publishUserNotes(active, "collecting");
    while (active.loadedPages < active.input.maxPages && active.hasMore) {
      await browserManager.showPage(active.page);
      await scrollForMore(active.page);
      await sleep(2_200);
      await Promise.all([...active.pending]);
      if (active.loadedPages < active.input.maxPages) active.loadedPages += 1;
      await this.publishUserNotes(active, "collecting");
    }
    if (!active.items.size) throw new Error("小红书用户笔记接口已完成分页，但没有解析到笔记");
    active.terminal = true;
    active.filePath = await appStore.exportVideos([...active.items.values()]);
    await this.publishUserNotes(active, "completed");
    return this.userNotesResult(active);
  }

  private async extendVideos(active: ActiveVideoSearch, targetPages: number): Promise<VideoCollectionResult> {
    active.terminal = false;
    active.input = { ...active.input, maxPages: targetPages };
    while (active.loadedPages < targetPages && active.hasMore) {
      await browserManager.showPage(active.page);
      await scrollForMore(active.page);
      await sleep(2_200);
      await Promise.all([...active.pending]);
      active.loadedPages += 1;
      await this.publishVideos(active, "collecting");
    }
    const result = this.videoResult(active);
    active.terminal = true;
    await this.publishVideos(active, "completed");
    return result;
  }

  private async extendUsers(active: ActiveUserSearch, targetPages: number): Promise<UserCollectionResult> {
    active.terminal = false;
    active.input = { ...active.input, maxPages: targetPages };
    while (active.loadedPages < targetPages && active.hasMore) {
      await browserManager.showPage(active.page);
      await scrollForMore(active.page);
      await sleep(2_200);
      await Promise.all([...active.pending]);
      active.loadedPages += 1;
      await this.publishUsers(active, "collecting");
    }
    const result = this.userResult(active);
    active.terminal = true;
    await this.publishUsers(active, "completed");
    return result;
  }
}

export const xiaohongshuCollector = new XiaohongshuCollector();
