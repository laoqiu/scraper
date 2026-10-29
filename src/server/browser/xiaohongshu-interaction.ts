import type { Page } from "puppeteer-core";
import { appStore } from "../store.js";
import type { VideoSearchInput } from "../types.js";
import { sleep } from "./interaction.js";

export async function requireXiaohongshuLogin(): Promise<void> {
  const account = await appStore.loadPlatformAccount("xiaohongshu");
  if (account?.status !== 1) {
    throw new Error("小红书登录状态不可用，请先调用 xiaohongshu.get_cookie（宿主工具名：mcp.scraper.xiaohongshu.get_cookie）");
  }
}

function selectedFilterLabels(input: VideoSearchInput): Array<{ group: string; label: string }> {
  const filters = input.filters;
  const values: Array<{ group: string; label: string }> = [];
  const sortLabels: Record<string, string> = {
    latest: "最新",
    "most-liked": "最多点赞",
    "most-commented": "最多评论",
    "most-collected": "最多收藏",
  };
  const publishLabels: Record<string, string> = { day: "一天内", week: "一周内", "half-year": "半年内" };
  const scopeLabels: Record<string, string> = { following: "已关注", watched: "已看过", unwatched: "未看过" };
  const locationLabels: Record<string, string> = { city: "同城", nearby: "附近" };
  if (sortLabels[filters.sort]) values.push({ group: "排序依据", label: sortLabels[filters.sort] });
  if (filters.contentType === "video") values.push({ group: "笔记类型", label: "视频" });
  if (filters.contentType === "image-text") values.push({ group: "笔记类型", label: "图文" });
  if (publishLabels[filters.publishTime]) values.push({ group: "发布时间", label: publishLabels[filters.publishTime] });
  if (scopeLabels[filters.searchScope ?? "all"]) values.push({ group: "搜索范围", label: scopeLabels[filters.searchScope ?? "all"] });
  if (locationLabels[filters.location ?? "all"]) values.push({ group: "位置距离", label: locationLabels[filters.location ?? "all"] });
  return values;
}

export function hasXiaohongshuVideoFilters(input: VideoSearchInput): boolean {
  return selectedFilterLabels(input).length > 0;
}

async function hoverFilterButton(page: Page, timeout = 15_000): Promise<boolean> {
  const selector = ".search-layout__top .filter";
  try {
    await page.waitForSelector(selector, { visible: true, timeout });
  } catch {
    return false;
  }

  // The filter button can be replaced once the search layout finishes
  // hydrating. Resolve the current element and its box after the wait instead
  // of hovering the handle returned by the initial selector lookup.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const button = await page.$(selector);
    const box = await button?.boundingBox();
    if (box && box.width > 0 && box.height > 0) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      return true;
    }
    await sleep(200);
  }
  return false;
}

type FilterLayerSnapshot = {
  text: string;
};

async function readFilterLayerSnapshot(page: Page): Promise<FilterLayerSnapshot> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
    const visible = (element: Element): boolean => {
      const node = element as HTMLElement;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return !node.closest("[aria-hidden='true']")
        && style.display !== "none"
        && style.visibility !== "hidden"
        && style.opacity !== "0"
        && style.pointerEvents !== "none"
        && rect.width > 0
        && rect.height > 0;
    };
    const groups = Array.from(document.querySelectorAll(".filters-wrapper .filters, [class~='filters']"))
      .filter(visible)
      .map((element) => {
        const heading = Array.from(element.children).find((child) => visible(child));
        const group = normalize(heading?.textContent ?? "");
        const options = Array.from(element.querySelectorAll(".tags, [role='option']"))
          .filter(visible)
          .map((option) => normalize(option.textContent ?? ""))
          .filter(Boolean);
        return { group, options };
      })
      .filter((item) => item.group && item.options.length > 0);

    return { text: groups.map((item) => `${item.group}: ${item.options.join(" | ")}`).join(" || ") };
  }).catch(() => ({ text: "" }));
}

async function waitForFilterLayer(page: Page, timeout = 15_000): Promise<boolean> {
  // Hover only once. The XHS popup is controlled by the real pointer state;
  // hovering the button again while the layer is opening can toggle it closed.
  const hovered = await hoverFilterButton(page, timeout);
  if (!hovered) return false;

  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const snapshot = await readFilterLayerSnapshot(page);
    if (snapshot.text) return true;
    await sleep(180);
  }
  return false;
}

async function clickFilterOption(page: Page, group: string, label: string): Promise<boolean> {
  const box = await page.evaluate(({ group, label }) => {
    const normalize = (value: string): string => value.replace(/\s+/g, "").trim();
    const visible = (element: Element): boolean => {
      const node = element as HTMLElement;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return !node.closest("[aria-hidden='true']")
        && style.display !== "none"
        && style.visibility !== "hidden"
        && style.opacity !== "0"
        && style.pointerEvents !== "none"
        && rect.width > 0
        && rect.height > 0;
    };
    const groups = Array.from(document.querySelectorAll(".filters-wrapper .filters, [class~='filters'], [class*='filter']"))
      .filter(visible);
    const target = groups.find((candidate) => {
      const hasGroup = Array.from(candidate.children).some((child) => {
        return visible(child) && normalize(child.textContent ?? "") === normalize(group);
      });
      if (!hasGroup) return false;
      return Array.from(candidate.querySelectorAll(".tags, [role='option']"))
        .some((option) => visible(option) && normalize(option.textContent ?? "") === normalize(label));
    });
    if (!target) return null;
    const option = Array.from(target.querySelectorAll(".tags, [role='option']"))
      .filter(visible)
      .find((candidate) => normalize(candidate.textContent ?? "") === normalize(label));
    if (!option) return null;
    const rect = option.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, { group, label }).catch(() => null);

  if (!box) return false;
  // Keep the real pointer inside the already-open popup. This is important:
  // XHS closes the layer when the pointer leaves it, so every next option must
  // be selected from the same hover session rather than by hovering again.
  await page.mouse.move(box.x, box.y);
  await sleep(100);
  await page.mouse.click(box.x, box.y);
  return true;
}

export async function applyXiaohongshuVideoFilters(
  page: Page,
  input: VideoSearchInput,
  enableCapture: () => void,
): Promise<void> {
  const selected = selectedFilterLabels(input);
  if (!selected.length) {
    enableCapture();
    return;
  }
  const layerReady = await waitForFilterLayer(page);
  if (!layerReady) {
    const snapshot = await readFilterLayerSnapshot(page);
    console.warn(`[scraper] 小红书筛选弹层未打开; 弹层内容: ${snapshot.text || "<empty>"}`);
    return;
  }
  for (const [index, item] of selected.entries()) {
    if (index === selected.length - 1) enableCapture();
    let clicked = false;
    const deadline = Date.now() + 3_000;
    while (!clicked && Date.now() < deadline) {
      clicked = await clickFilterOption(page, item.group, item.label);
      if (!clicked) await sleep(180);
    }
    if (!clicked) {
      const snapshot = await readFilterLayerSnapshot(page);
      console.warn(
        `[scraper] 小红书筛选选项未找到: ${item.group}/${item.label}; `
        + `弹层内容: ${snapshot.text || "<empty>"}`,
      );
    }
    await sleep(700);
  }
  // Let the popup close only after all requested options have been selected.
  await page.mouse.move(0, 0);
  await sleep(200);
}

export async function clickXiaohongshuUserTab(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const tab = await page.$("#channel-container #user");
    if (tab) {
      await tab.click();
      await sleep(700);
      return;
    }
    await sleep(300);
  }
  throw new Error("未找到小红书用户搜索标签");
}
