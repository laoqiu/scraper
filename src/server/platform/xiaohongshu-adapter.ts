import type { PlatformAdapter } from "./types.js";

const allowedHosts = [
  "xiaohongshu.com",
  "xhscdn.com",
  "xhscdn.net",
  "xhslink.com",
] as const;

export const xiaohongshuAdapter: PlatformAdapter = {
  id: "xiaohongshu",
  displayName: "小红书",
  homepage: "https://www.xiaohongshu.com/",
  media: {
    referer: "https://www.xiaohongshu.com/",
    origin: "https://www.xiaohongshu.com",
    allowedHosts,
  },
  videoSearchUrl: (keyword) => `https://www.xiaohongshu.com/search_result_ai?keyword=${encodeURIComponent(keyword)}&source=web_explore_feed&type=51`,
  userSearchUrl: (keyword) => `https://www.xiaohongshu.com/search_result_ai?keyword=${encodeURIComponent(keyword)}&source=web_explore_feed&type=51`,
  isMediaUrlSupported: (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
    } catch {
      return false;
    }
  },
};
