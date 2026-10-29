import type { HTTPResponse, Page } from "puppeteer-core";
import { loginService } from "./login-service.js";
import { appStore } from "../store.js";
import type { UserSearchInput, VideoSearchInput } from "../types.js";

export const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));
export const FIRST_PAGE_TIMEOUT = 45_000;

export function logUserDetail(message: string, ...values: unknown[]): void {
  console.error(`[douyin] user-detail ${message}`, ...values);
}

async function clickText(page: Page, labels: string[]): Promise<boolean> {
  const handles = await page.$$("button, [role='button'], span, a, div");
  for (const handle of handles) {
    const matches = await handle.evaluate((element, wanted) => {
      const label = (element as HTMLElement).innerText?.trim();
      return Boolean(label && wanted.includes(label) && (element as HTMLElement).offsetParent !== null);
    }, labels);
    if (!matches) {
      await handle.dispose();
      continue;
    }
    const box = await handle.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await handle.dispose();
      return true;
    }
    await handle.dispose();
  }
  return false;
}

async function hoverText(page: Page, labels: string[]): Promise<boolean> {
  const handles = await page.$$("button, [role='button'], span, a, div");
  for (const handle of handles) {
    const matches = await handle.evaluate((element, wanted) => {
      const label = (element as HTMLElement).innerText?.trim();
      return Boolean(label && wanted.includes(label) && (element as HTMLElement).offsetParent !== null);
    }, labels);
    if (!matches) {
      await handle.dispose();
      continue;
    }
    const box = await handle.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await handle.dispose();
      return true;
    }
    await handle.dispose();
  }
  return false;
}

async function clickFilterOption(page: Page, groupIndex: number, labels: string[]): Promise<boolean> {
  const handles = await page.$$(`span[data-index1="${groupIndex}"][data-index2]`);
  for (const handle of handles) {
    const matches = await handle.evaluate((element, wanted) => {
      const label = (element as HTMLElement).innerText?.trim();
      return Boolean(label && wanted.includes(label) && (element as HTMLElement).offsetParent !== null);
    }, labels);
    if (!matches) {
      await handle.dispose();
      continue;
    }
    const box = await handle.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await handle.dispose();
      return true;
    }
    await handle.dispose();
  }
  return false;
}

export function hasVideoFilters(input: VideoSearchInput): boolean {
  const filter = input.filters;
  return filter.sort !== "general"
    || filter.publishTime !== "all"
    || filter.duration !== "all"
    || (filter.searchScope ?? "all") !== "all"
    || (filter.contentType ?? "all") !== "all";
}

export function hasUserFilters(input: UserSearchInput): boolean {
  return input.filters.followerCount !== "all" || input.filters.userType !== "all";
}

export async function applyUserFilterControls(page: Page, input: UserSearchInput, enableCapture: () => void): Promise<void> {
  if (!hasUserFilters(input)) return;
  let filterHovered = false;
  for (let attempt = 0; attempt < 10 && !filterHovered; attempt += 1) {
    filterHovered = await hoverText(page, ["筛选"]);
    if (!filterHovered) await sleep(300);
  }
  if (!filterHovered) throw new Error("未找到抖音用户筛选按钮，无法应用筛选条件");
  await sleep(700);
  const followerLabels: Record<UserSearchInput["filters"]["followerCount"], string[]> = {
    all: [], "under-1000": ["1000以下"], "1000-1w": ["1000-1w"], "1w-10w": ["1w-10w"], "10w-100w": ["10w-100w"], "over-100w": ["100w以上"],
  };
  const userTypeLabels: Record<UserSearchInput["filters"]["userType"], string[]> = {
    all: [], ordinary: ["普通用户"], enterprise: ["企业认证"], personal: ["个人认证"],
  };
  const selected = [
    { index: 0, labels: followerLabels[input.filters.followerCount] },
    { index: 1, labels: userTypeLabels[input.filters.userType] },
  ].filter((item) => item.labels.length > 0);
  for (const [position, item] of selected.entries()) {
    if (position === selected.length - 1) enableCapture();
    let clicked = false;
    for (let attempt = 0; attempt < 6 && !clicked; attempt += 1) {
      clicked = await clickFilterOption(page, item.index, item.labels);
      if (!clicked) await sleep(250);
    }
    if (!clicked) console.warn(`[douyin] 用户筛选选项未找到: ${item.labels.join("/")}`);
    await sleep(650);
  }
  await clickText(page, ["确定", "确认"]);
  await sleep(1_600);
}

export async function applyVideoFilterControls(page: Page, input: VideoSearchInput, enableCapture: () => void): Promise<void> {
  const filter = input.filters;
  if (!hasVideoFilters(input)) return;
  let filterHovered = false;
  for (let attempt = 0; attempt < 10 && !filterHovered; attempt += 1) {
    filterHovered = await hoverText(page, ["筛选"]);
    if (!filterHovered) await sleep(300);
  }
  if (!filterHovered) throw new Error("未找到抖音筛选按钮，无法应用筛选条件");
  await sleep(700);
  const selectedFilters = [
    filter.sort === "latest" ? ["最新发布", "最新"] : filter.sort === "most-liked" ? ["最多点赞"] : [],
    filter.publishTime === "day" ? ["一天内"] : filter.publishTime === "week" ? ["一周内"] : filter.publishTime === "half-year" ? ["半年内"] : [],
    filter.duration === "short" ? ["1分钟以下"] : filter.duration === "medium" ? ["1-5分钟"] : filter.duration === "long" ? ["5分钟以上"] : [],
    filter.searchScope === "following" ? ["关注的人"] : filter.searchScope === "watched" ? ["最近看过"] : filter.searchScope === "unwatched" ? ["还未看过"] : [],
    filter.contentType === "video" ? ["视频"] : filter.contentType === "image-text" ? ["图文"] : [],
  ].map((labels, index) => ({ index, labels })).filter(({ labels }) => labels.length > 0);
  for (const [index, selected] of selectedFilters.entries()) {
    if (index === selectedFilters.length - 1) enableCapture();
    let clicked = false;
    for (let attempt = 0; attempt < 6 && !clicked; attempt += 1) {
      clicked = await clickFilterOption(page, selected.index, selected.labels);
      if (!clicked) await sleep(250);
    }
    if (!clicked) console.warn(`[douyin] 筛选选项未找到: ${selected.labels.join("/")}`);
    await sleep(650);
  }
  await clickText(page, ["确定", "确认"]);
  await sleep(1_600);
}

export async function scrollForMore(page: Page): Promise<void> {
  for (let step = 0; step < 4; step += 1) {
    let completed = false;
    for (let attempt = 0; attempt < 3 && !completed; attempt += 1) {
      try {
        await page.evaluate(() => {
          const distance = Math.max(420, Math.floor(window.innerHeight * 0.75));
          window.scrollBy({ top: distance, behavior: "auto" });
          document.querySelectorAll<HTMLElement>("*").forEach((element) => {
            const style = window.getComputedStyle(element);
            if ((style.overflowY === "auto" || style.overflowY === "scroll") && element.scrollHeight > element.clientHeight + 100) {
              element.scrollTop = Math.min(element.scrollTop + Math.floor(element.clientHeight * 0.75), element.scrollHeight);
            }
          });
          window.dispatchEvent(new Event("scroll"));
        });
        completed = true;
      } catch (error) {
        if (!isDetachedFrameError(error) || page.isClosed() || attempt === 2) throw error;
        await sleep(350);
      }
    }
    await sleep(180);
  }
}

function isDetachedFrameError(error: unknown): boolean {
  return error instanceof Error && /detached frame|frame .* detached/i.test(error.message);
}

export async function responseText(response: HTTPResponse): Promise<string> {
  if (response.status() === 401 || response.status() === 403) {
    await loginService.invalidate(`抖音请求返回 ${response.status()}，请重新登录`);
    return "";
  }
  if (response.status() >= 400) return "";
  try {
    return await response.text();
  } catch {
    return "";
  }
}

export async function requireLogin(): Promise<void> {
  if (!await loginService.prepareSession()) throw new Error("抖音登录状态不可用，请先调用 get_cookie 完成登录");
}

export async function captureFailure(page: Page, prefix: string): Promise<void> {
  try {
    await page.screenshot({ path: await appStore.diagnosticPath(prefix), fullPage: false });
  } catch (error) {
    console.error("[douyin] diagnostic screenshot failed", error);
  }
}
