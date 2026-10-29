import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ExportProgress } from "../../export-model.js";
import { appStore } from "../store.js";
import type { DouyinVideo, VideoFileRecord } from "../types.js";
import { videoProxy } from "./video-proxy.js";
import { xiaohongshuCollector } from "./xiaohongshu-collector.js";

const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

export interface VideoDownloadResult {
  videos: DouyinVideo[];
  files: VideoFileRecord[];
}

export interface DownloadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
}

export class VideoDownloader {
  async download(videos: DouyinVideo[], options: DownloadOptions = {}): Promise<VideoDownloadResult> {
    const output: DouyinVideo[] = [];
    const files: VideoFileRecord[] = [];

    const publish = (currentTitle?: string) => options.onProgress?.({
      phase: "downloading", processed: files.length, currentTitle,
      downloadedCount: files.filter((file) => file.status === "downloaded").length,
      existingCount: files.filter((file) => file.status === "existing").length,
      failedCount: files.filter((file) => file.status === "failed").length,
      skippedCount: files.filter((file) => file.status === "not-video" || file.status === "missing-url").length,
    });
    options.signal?.throwIfAborted();
    for (const video of videos) {
      options.signal?.throwIfAborted();
      publish(video.title || video.id);
      try {
        if (video.type !== "video") {
          output.push({ ...video, downloadStatus: "not-video" });
          files.push({ videoId: video.id, platform: video.platform ?? "douyin", status: "not-video" });
          continue;
        }
        const platform = video.platform ?? "douyin";
        const account = await appStore.loadPlatformAccount(platform);
        const cookie = account?.cookie ?? "";
        const userAgent = account?.user_agent || DEFAULT_USER_AGENT;
        const target = appStore.videoFilePath(platform, video.id);
        try {
          const existing = await fs.stat(target);
          if (existing.isFile() && existing.size > 0) {
            output.push({ ...video, localPath: target, downloadStatus: "existing" });
            files.push({ videoId: video.id, platform, localPath: target, status: "existing", size: existing.size });
            continue;
          }
        } catch {
          // The file does not exist yet.
        }

        let playUrl = video.playUrl;
        if (!playUrl && video.platform === "xiaohongshu" && video.xsecToken) {
          try {
            playUrl = await xiaohongshuCollector.resolveVideoSource(video.id, video.xsecToken, options.signal);
          } catch (error) {
            options.signal?.throwIfAborted();
            output.push({ ...video, downloadStatus: "missing-url" });
            files.push({
              videoId: video.id,
              platform: video.platform,
              status: "missing-url",
              error: error instanceof Error ? error.message : String(error),
            });
            continue;
          }
        }
        options.signal?.throwIfAborted();
        if (!playUrl) {
          output.push({ ...video, downloadStatus: "missing-url" });
          files.push({ videoId: video.id, platform: video.platform ?? "douyin", status: "missing-url" });
          continue;
        }

        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
          await fs.mkdir(path.dirname(target), { recursive: true });
          const timeout = AbortSignal.timeout(120_000);
          const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
          await videoProxy.download(playUrl, cookie, userAgent, temporary, signal);
          signal.throwIfAborted();
          const stat = await fs.stat(temporary);
          if (!stat.isFile() || stat.size === 0) throw new Error("下载文件为空");
          await fs.rename(temporary, target);
          output.push({ ...video, playUrl, localPath: target, downloadStatus: "downloaded" });
          files.push({ videoId: video.id, platform, localPath: target, status: "downloaded", size: stat.size });
        } catch (error) {
          await fs.rm(temporary, { force: true }).catch(() => undefined);
          options.signal?.throwIfAborted();
          const message = error instanceof Error ? error.message : String(error);
          output.push({ ...video, downloadStatus: "failed" });
          files.push({ videoId: video.id, platform, status: "failed", error: message });
        }
      } finally {
        if (!options.signal?.aborted) publish();
      }
    }

    return { videos: output, files };
  }
}

export const videoDownloader = new VideoDownloader();
