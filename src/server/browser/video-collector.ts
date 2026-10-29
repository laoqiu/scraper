import { randomUUID } from "node:crypto";
import type { HTTPResponse } from "puppeteer-core";
import { applyVideoFilters, parseVideoPage } from "../parsers.js";
import { appStore } from "../store.js";
import type { DouyinVideo, VideoCollectionResult, VideoSearchInput } from "../types.js";
import { browserManager } from "./browser-manager.js";
import {
  applyVideoFilterControls,
  captureFailure,
  FIRST_PAGE_TIMEOUT,
  hasVideoFilters,
  requireLogin,
  responseText,
  scrollForMore,
  sleep,
} from "./interaction.js";
import { endpointPatterns, urlMatches } from "./selectors.js";
import type { ActiveVideoSearch } from "./collection-types.js";
import { videoSearchKey } from "./collection-types.js";

export class VideoCollector {
  private active?: ActiveVideoSearch;

  clear(): void {
    if (!this.active) return;
    this.active.terminal = true;
    this.active.page.off("response", this.active.handleResponse);
    this.active = undefined;
  }

  async collect(input: VideoSearchInput): Promise<VideoCollectionResult> {
    return browserManager.runCollection(async () => {
      const existing = this.active;
      if (existing && existing.key === videoSearchKey(input) && !existing.page.isClosed() && input.maxPages > existing.loadedPages) {
        return this.extend(existing, input.maxPages);
      }
      this.clear();
      await requireLogin();
      await appStore.update({
        lastVideos: undefined,
        lastVideoSearch: input,
        videoProgress: { status: "collecting", pages: 0, maxPages: input.maxPages, itemCount: 0 },
      });

      const page = await browserManager.getPage();
      const items = new Map<string, DouyinVideo>();
      const pending = new Set<Promise<void>>();
      let resolveFirstPage!: () => void;
      const active: ActiveVideoSearch = {
        jobId: randomUUID(),
        key: videoSearchKey(input),
        page,
        input,
        items,
        pending,
        handleResponse: () => undefined,
        captureEnabled: false,
        firstPage: new Promise<void>((resolve) => { resolveFirstPage = resolve; }),
        firstPageResolved: false,
        loadedPages: 0,
        hasMore: true,
        terminal: false,
      };
      const handleResponse = (response: HTTPResponse): void => {
        if (!active.captureEnabled || !urlMatches(response.url(), endpointPatterns.videoSearch)) return;
        const task = responseText(response).then(async (body) => {
          const before = items.size;
          const parsed = parseVideoPage(body);
          for (const item of parsed.items) items.set(item.id, item);
          if (parsed.hasMore === false) active.hasMore = false;
          await this.publish(active, "collecting");
          if (items.size > before && !active.firstPageResolved) {
            active.firstPageResolved = true;
            resolveFirstPage();
          }
        }).finally(() => pending.delete(task));
        pending.add(task);
      };
      active.handleResponse = handleResponse;
      this.active = active;
      page.on("response", handleResponse);
      try {
        await browserManager.showPage(page);
        const hasFilters = hasVideoFilters(input);
        active.captureEnabled = !hasFilters;
        if (!hasFilters) await sleep(300);
        await page.goto(`https://www.douyin.com/search/${encodeURIComponent(input.keyword)}?type=general`, { waitUntil: "domcontentloaded" });
        await applyVideoFilterControls(page, input, () => { active.captureEnabled = true; });
        await Promise.race([active.firstPage, sleep(FIRST_PAGE_TIMEOUT)]);
        if (items.size === 0) throw new Error("未获取到视频搜索结果");
        active.loadedPages = 1;
        const result = await this.extend(active, input.maxPages);
        await Promise.all([...pending]);
        return result;
      } catch (error) {
        active.terminal = true;
        this.clear();
        await Promise.allSettled([...pending]);
        await this.publish(active, "error", error instanceof Error ? error.message : String(error));
        await captureFailure(page, "video-collection-failed");
        throw error;
      }
    });
  }

  private result(active: ActiveVideoSearch): VideoCollectionResult {
    return {
      kind: "videos",
      jobId: active.jobId,
      keyword: active.input.keyword,
      filters: active.input.filters,
      items: applyVideoFilters([...active.items.values()], active.input.filters),
      collectedAt: new Date().toISOString(),
      pages: active.loadedPages,
      hasMore: active.hasMore,
    };
  }

  private async publish(active: ActiveVideoSearch, status: "collecting" | "completed" | "error", message?: string): Promise<void> {
    if (status === "collecting" && active.terminal) return;
    const result = this.result(active);
    try {
      await appStore.update({
        lastVideos: result,
        videoProgress: {
          status,
          pages: Math.max(1, active.loadedPages),
          maxPages: active.input.maxPages,
          itemCount: result.items.length,
          message,
        },
      });
    } catch (error) {
      console.warn("[douyin] video progress update failed", error);
    }
  }

  private async extend(active: ActiveVideoSearch, targetPages: number): Promise<VideoCollectionResult> {
    active.terminal = false;
    active.input = { ...active.input, maxPages: targetPages };
    await appStore.update({
      lastVideoSearch: active.input,
      videoProgress: { status: "collecting", pages: Math.max(1, active.loadedPages), maxPages: targetPages, itemCount: active.items.size },
    });
    while (active.loadedPages < targetPages && active.hasMore) {
      await browserManager.showPage(active.page);
      await scrollForMore(active.page);
      await sleep(2_200);
      await Promise.all([...active.pending]);
      active.loadedPages += 1;
      const result = this.result(active);
      await appStore.update({
        lastVideoSearch: active.input,
        lastVideos: result,
        videoProgress: { status: "collecting", pages: active.loadedPages, maxPages: targetPages, itemCount: result.items.length },
      });
    }
    const result = this.result(active);
    active.terminal = true;
    await appStore.update({
      lastVideoSearch: active.input,
      lastVideos: result,
      videoProgress: { status: "completed", pages: active.loadedPages, maxPages: targetPages, itemCount: result.items.length },
    });
    return result;
  }
}
