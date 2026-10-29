import { douyinAdapter } from "./douyin-adapter.js";
import { kuaishouAdapter } from "./kuaishou-adapter.js";
import { xiaohongshuAdapter } from "./xiaohongshu-adapter.js";
import type { PlatformAdapter } from "./types.js";

const adapters: readonly PlatformAdapter[] = [douyinAdapter, kuaishouAdapter, xiaohongshuAdapter];

export function getPlatformAdapter(platform: PlatformAdapter["id"]): PlatformAdapter {
  const adapter = adapters.find((item) => item.id === platform);
  if (!adapter) throw new Error(`未注册的平台 Adapter：${platform}`);
  return adapter;
}

export function detectPlatformByMediaUrl(value: string): PlatformAdapter | undefined {
  return adapters.find((adapter) => adapter.isMediaUrlSupported(value));
}

export function listPlatformAdapters(): readonly PlatformAdapter[] {
  return adapters;
}
