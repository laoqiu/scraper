import type { PlatformAdapter } from "./types.js";

const allowedHosts = [
  "douyin.com",
  "douyinvod.com",
  "douyinpic.com",
  "byteimg.com",
  "douyincdn.com",
  "snssdk.com",
  "ibytedtos.com",
  "bytecdn.cn",
  "pstatp.com",
] as const;

export const douyinAdapter: PlatformAdapter = {
  id: "douyin",
  displayName: "抖音",
  homepage: "https://www.douyin.com/",
  media: {
    referer: "https://www.douyin.com/",
    origin: "https://www.douyin.com",
    allowedHosts,
  },
  videoSearchUrl: (keyword) => `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=general`,
  userSearchUrl: (keyword) => `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=user`,
  isMediaUrlSupported: (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
    } catch {
      return false;
    }
  },
};
