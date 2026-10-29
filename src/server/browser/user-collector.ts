import { randomUUID } from "node:crypto";
import type { HTTPResponse } from "puppeteer-core";
import { parseUserDetailRaw, parseUserPage, parseUserProfile, parseVideoPage } from "../parsers.js";
import { appStore } from "../store.js";
import type {
  DouyinUser,
  DouyinVideo,
  UserCollectionResult,
  UserDetailCache,
  UserDetailCollectionResult,
  UserDetailInput,
  UserSearchInput,
} from "../types.js";
import { browserManager } from "./browser-manager.js";
import {
  applyUserFilterControls,
  captureFailure,
  FIRST_PAGE_TIMEOUT,
  hasUserFilters,
  logUserDetail,
  requireLogin,
  responseText,
  scrollForMore,
  sleep,
} from "./interaction.js";
import { endpointPatterns, urlMatches } from "./selectors.js";
import type { ActiveUserDetail, ActiveUserSearch } from "./collection-types.js";
import { userSearchKey } from "./collection-types.js";

export class UserCollector {
  private activeSearch?: ActiveUserSearch;
  private activeDetail?: ActiveUserDetail;

  isSearchRunning(): boolean {
    return this.activeSearch?.running === true;
  }

  clearSearch(): void {
    if (!this.activeSearch) return;
    this.activeSearch.terminal = true;
    this.activeSearch.page.off("response", this.activeSearch.handleResponse);
    this.activeSearch = undefined;
  }

  clearDetail(): void {
    if (!this.activeDetail) return;
    this.activeDetail.terminal = true;
    this.activeDetail.page.off("response", this.activeDetail.handleResponse);
    this.activeDetail = undefined;
  }

  async search(input: UserSearchInput): Promise<UserCollectionResult> {
    return browserManager.runCollection(async () => {
      const existing = this.activeSearch;
      if (existing && existing.key === userSearchKey(input) && !existing.page.isClosed()) {
        if (input.maxPages > existing.loadedPages) {
          existing.running = true;
          try {
            return await this.extendSearch(existing, input.maxPages);
          } finally {
            existing.running = false;
          }
        }
        return this.searchResult(existing);
      }

      this.clearSearch();
      await requireLogin();
      await appStore.update({
        lastUsers: undefined,
        lastUserSearch: input,
        userProgress: { status: "collecting", pages: 0, maxPages: input.maxPages, itemCount: 0 },
      });
      const page = await browserManager.getPage();
      const items = new Map<string, DouyinUser>();
      const pending = new Set<Promise<void>>();
      let resolveFirstPage!: () => void;
      const active: ActiveUserSearch = {
        jobId: randomUUID(),
        key: userSearchKey(input),
        page,
        input,
        items,
        pending,
        handleResponse: () => undefined,
        captureEnabled: !hasUserFilters(input),
        firstPage: new Promise<void>((resolve) => { resolveFirstPage = resolve; }),
        firstPageResolved: false,
        loadedPages: 0,
        hasMore: true,
        running: true,
        terminal: false,
      };
      const handleResponse = (response: HTTPResponse): void => {
        if (!active.captureEnabled || !urlMatches(response.url(), endpointPatterns.userSearch)) return;
        const task = responseText(response).then(async (body) => {
          const parsed = parseUserPage(body);
          for (const item of parsed.items) items.set(item.secUid || item.uid, item);
          if (parsed.hasMore === false) active.hasMore = false;
          await this.publishSearch(active, "collecting");
          if (items.size > 0 && !active.firstPageResolved) {
            active.firstPageResolved = true;
            resolveFirstPage();
          }
        }).finally(() => pending.delete(task));
        pending.add(task);
      };
      active.handleResponse = handleResponse;
      this.activeSearch = active;
      page.on("response", handleResponse);
      try {
        await browserManager.showPage(page);
        await page.goto(`https://www.douyin.com/search/${encodeURIComponent(input.keyword)}?type=user`, { waitUntil: "domcontentloaded" });
        await applyUserFilterControls(page, input, () => { active.captureEnabled = true; });
        await Promise.race([active.firstPage, sleep(FIRST_PAGE_TIMEOUT)]);
        if (items.size === 0) throw new Error("未获取到用户搜索结果");
        active.loadedPages = 1;
        const result = await this.extendSearch(active, input.maxPages);
        await Promise.all([...pending]);
        active.running = false;
        return result;
      } catch (error) {
        active.running = false;
        active.terminal = true;
        this.clearSearch();
        await Promise.allSettled([...pending]);
        await this.publishSearch(active, "error", error instanceof Error ? error.message : String(error));
        await captureFailure(page, "user-collection-failed");
        throw error;
      }
    });
  }

  async detail(input: UserDetailInput): Promise<UserDetailCollectionResult> {
    return browserManager.runCollection(async () => {
      logUserDetail("start", { secUid: input.secUid, maxPages: input.maxPages });
      const existing = this.activeDetail;
      if (existing && existing.input.secUid === input.secUid && !existing.page.isClosed()) {
        return this.extendDetail(existing, input.maxPages);
      }
      this.clearSearch();
      this.clearDetail();
      await requireLogin();
      await appStore.update({
        lastUserDetail: undefined,
        currentUser: undefined,
        userDetailProgress: { secUid: input.secUid, status: "collecting", pages: 0, maxPages: input.maxPages, itemCount: 0 },
      });
      const page = await browserManager.getPage();
      const items = new Map<string, DouyinVideo>();
      const pending = new Set<Promise<void>>();
      let resolveFirstPage!: () => void;
      const active: ActiveUserDetail = {
        jobId: randomUUID(),
        page,
        input,
        items,
        awemeList: [],
        pending,
        handleResponse: () => undefined,
        firstPage: new Promise<void>((resolve) => { resolveFirstPage = resolve; }),
        firstPageResolved: false,
        loadedPages: 0,
        hasMore: true,
        terminal: false,
      };
      const handleResponse = (response: HTTPResponse): void => {
        const isPost = urlMatches(response.url(), endpointPatterns.userPosts);
        const isProfile = urlMatches(response.url(), endpointPatterns.userProfile);
        if (!isPost && !isProfile) return;
        logUserDetail("response matched", { kind: isProfile ? "profile" : "posts", status: response.status(), url: response.url() });
        const task = responseText(response).then(async (body) => {
          let pageItemCount = 0;
          const raw = parseUserDetailRaw(body);
          if (raw.author) active.author = raw.author;
          if (raw.awemeList.length) active.awemeList.push(...raw.awemeList);
          if (isProfile) {
            const user = parseUserProfile(body);
            if (user) active.user = user;
          }
          if (isPost) {
            const parsed = parseVideoPage(body);
            pageItemCount = parsed.items.length;
            for (const item of parsed.items) items.set(item.id, item);
            if (parsed.hasMore === false) active.hasMore = false;
          }
          active.loadedPages = Math.max(1, active.loadedPages);
          await this.publishDetail(active, "collecting");
          logUserDetail("response parsed", {
            kind: isProfile ? "profile" : "posts",
            bodyBytes: body.length,
            userFound: Boolean(active.user),
            pageItems: pageItemCount,
            totalItems: items.size,
            hasMore: active.hasMore,
          });
          if (!active.firstPageResolved && (active.user || items.size > 0)) {
            active.firstPageResolved = true;
            resolveFirstPage();
          }
        }).finally(() => pending.delete(task));
        pending.add(task);
      };
      active.handleResponse = handleResponse;
      this.activeDetail = active;
      page.on("response", handleResponse);
      try {
        await browserManager.showPage(page);
        const targetUrl = `https://www.douyin.com/user/${encodeURIComponent(input.secUid)}?from_tab_name=main`;
        logUserDetail("navigate", targetUrl);
        await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
        await Promise.race([active.firstPage, sleep(FIRST_PAGE_TIMEOUT)]);
        await Promise.all([...pending]);
        await this.publishDetail(active, "collecting");
        if (!active.user && items.size === 0) throw new Error("未获取到用户详情或作品数据");
        active.loadedPages = 1;
        return this.extendDetail(active, input.maxPages);
      } catch (error) {
        logUserDetail("failed", error instanceof Error ? error.message : String(error));
        active.terminal = true;
        this.clearDetail();
        await Promise.allSettled([...pending]);
        await appStore.update({
          userDetailProgress: {
            secUid: input.secUid,
            status: "error",
            pages: Math.max(1, active.loadedPages),
            maxPages: input.maxPages,
            itemCount: active.items.size,
            message: error instanceof Error ? error.message : String(error),
          },
        }).catch((progressError) => console.error("[douyin] user detail progress update failed", progressError));
        await captureFailure(page, "user-detail-collection-failed");
        throw error;
      }
    });
  }

  private searchResult(active: ActiveUserSearch): UserCollectionResult {
    return {
      kind: "users",
      jobId: active.jobId,
      keyword: active.input.keyword,
      filters: active.input.filters,
      items: [...active.items.values()],
      collectedAt: new Date().toISOString(),
      pages: active.loadedPages,
      hasMore: active.hasMore,
    };
  }

  private async publishSearch(active: ActiveUserSearch, status: "collecting" | "completed" | "error", message?: string): Promise<void> {
    if (status === "collecting" && active.terminal) return;
    const result = this.searchResult(active);
    await appStore.update({ lastUsers: result, userProgress: { status, pages: active.loadedPages, maxPages: active.input.maxPages, itemCount: result.items.length, message } });
  }

  private async extendSearch(active: ActiveUserSearch, targetPages: number): Promise<UserCollectionResult> {
    active.terminal = false;
    active.input = { ...active.input, maxPages: targetPages };
    await appStore.update({ lastUserSearch: active.input, userProgress: { status: "collecting", pages: active.loadedPages, maxPages: targetPages, itemCount: active.items.size } });
    while (active.loadedPages < targetPages && active.hasMore) {
      await browserManager.showPage(active.page);
      await scrollForMore(active.page);
      await sleep(2_200);
      await Promise.all([...active.pending]);
      active.loadedPages += 1;
      const result = this.searchResult(active);
      await appStore.update({ lastUserSearch: active.input, lastUsers: result, userProgress: { status: "collecting", pages: active.loadedPages, maxPages: targetPages, itemCount: result.items.length } });
    }
    const result = this.searchResult(active);
    await appStore.update({ lastUserSearch: active.input, lastUsers: result, userProgress: { status: "completed", pages: active.loadedPages, maxPages: targetPages, itemCount: result.items.length } });
    return result;
  }

  private detailResult(active: ActiveUserDetail): UserDetailCollectionResult {
    return {
      kind: "user-detail",
      jobId: active.jobId,
      secUid: active.input.secUid,
      user: active.user,
      items: [...active.items.values()],
      collectedAt: new Date().toISOString(),
      pages: active.loadedPages,
      hasMore: active.hasMore,
    };
  }

  private async publishDetail(active: ActiveUserDetail, status: "collecting" | "completed" | "error", message?: string): Promise<void> {
    if (status === "collecting" && active.terminal) return;
    const result = this.detailResult(active);
    await appStore.update({ lastUserDetail: result, currentUser: active.user, userDetailProgress: { secUid: active.input.secUid, status, pages: Math.max(1, active.loadedPages), maxPages: active.input.maxPages, itemCount: result.items.length, message } });
  }

  private async extendDetail(active: ActiveUserDetail, targetPages: number): Promise<UserDetailCollectionResult> {
    active.terminal = false;
    active.input = { ...active.input, maxPages: targetPages };
    await this.publishDetail(active, "collecting");
    while (active.loadedPages < targetPages && active.hasMore) {
      logUserDetail("request next page", { page: active.loadedPages + 1 });
      await browserManager.showPage(active.page);
      await scrollForMore(active.page);
      await sleep(2_200);
      await Promise.all([...active.pending]);
      active.loadedPages += 1;
      await this.publishDetail(active, "collecting");
      logUserDetail("next page complete", { page: active.loadedPages, itemCount: active.items.size, hasMore: active.hasMore });
    }
    const result = this.detailResult(active);
    active.terminal = true;
    const cache: UserDetailCache = {
      sec_uid: active.input.secUid,
      author: active.author ?? (active.user ? { ...active.user } : {}),
      aweme_list: active.awemeList,
      has_more: active.hasMore ? 1 : 0,
      pages: active.loadedPages,
      collected_at: result.collectedAt,
    };
    const cachePath = await appStore.saveUserDetailCache(active.input.secUid, cache);
    logUserDetail("cache saved", { path: cachePath, itemCount: active.awemeList.length });
    await this.publishDetail(active, "completed");
    return result;
  }
}
