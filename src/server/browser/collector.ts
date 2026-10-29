import { appStore } from "../store.js";
import type { UserDetailInput, UserSearchInput, VideoSearchInput } from "../types.js";
import { browserManager } from "./browser-manager.js";
import { UserCollector } from "./user-collector.js";
import { videoProxy } from "./video-proxy.js";
import { videoDownloader, type VideoDownloadResult, type DownloadOptions } from "./video-downloader.js";
import { VideoCollector } from "./video-collector.js";
import { xiaohongshuCollector } from "./xiaohongshu-collector.js";

/** Public collection façade. Browser sessions remain private to the domain collectors. */
export class DouyinCollector {
  private readonly videosService = new VideoCollector();
  private readonly usersService = new UserCollector();

  isUserSearchRunning(): boolean {
    return this.usersService.isSearchRunning();
  }

  async videos(input: VideoSearchInput) {
    if (input.platform === "xiaohongshu") return xiaohongshuCollector.videos(input);
    xiaohongshuCollector.clear();
    this.usersService.clearSearch();
    return this.videosService.collect(input);
  }

  async users(input: UserSearchInput) {
    if (input.platform === "xiaohongshu") return xiaohongshuCollector.users(input);
    xiaohongshuCollector.clear();
    this.videosService.clear();
    return this.usersService.search(input);
  }

  async userVideos(input: UserDetailInput) {
    xiaohongshuCollector.clear();
    this.usersService.clearSearch();
    this.videosService.clear();
    return this.usersService.detail(input);
  }

  async playVideo(videoId: string, playUrl: string, platform: import("../types.js").PlatformId = "douyin", xsecToken?: string): Promise<{ videoId: string; videoUrl: string }> {
    return browserManager.runCollection(async () => {
      if (platform === "xiaohongshu") {
        return xiaohongshuCollector.playVideo(videoId, xsecToken ?? "");
      }
      const account = await appStore.loadPlatformAccount(platform);
      const cookie = account?.cookie ?? "";
      const userAgent = account?.user_agent
        || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
      const videoUrl = await videoProxy.register(playUrl, cookie, userAgent, { platform });
      return { videoId, videoUrl };
    });
  }

  async downloadVideos(videos: import("../types.js").DouyinVideo[], options: DownloadOptions = {}): Promise<VideoDownloadResult> {
    return browserManager.runCollection(() => videoDownloader.download(videos, options));
  }
}

export const douyinCollector = new DouyinCollector();
