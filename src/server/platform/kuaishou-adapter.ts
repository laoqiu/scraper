import type { PlatformAdapter } from "./types.js";

const allowedHosts = [
  "kuaishou.com",
  "kwai.com",
  "ks-cdn.com",
  "kwimgs.com",
  "gifshow.com",
] as const;

export const kuaishouAdapter: PlatformAdapter = {
  id: "kuaishou",
  displayName: "快手",
  homepage: "https://www.kuaishou.com/",
  media: {
    referer: "https://www.kuaishou.com/",
    origin: "https://www.kuaishou.com",
    allowedHosts,
  },
  videoSearchUrl: (keyword) => `https://www.kuaishou.com/search/video?searchKey=${encodeURIComponent(keyword)}`,
  userSearchUrl: (keyword) => `https://www.kuaishou.com/search/user?searchKey=${encodeURIComponent(keyword)}`,
  isMediaUrlSupported: (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
    } catch {
      return false;
    }
  },
};
