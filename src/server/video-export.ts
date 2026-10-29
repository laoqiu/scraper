import { randomUUID } from "node:crypto";
import { douyinCollector } from "./browser/index.js";
import { ExportJobManager, type ExportRunner } from "./export-jobs.js";
import { appStore } from "./store.js";

const saveVideos: ExportRunner = async (videos, signal, progress) => {
  const batchId = randomUUID();
  const downloaded = await douyinCollector.downloadVideos(videos, { signal, onProgress: progress });
  signal.throwIfAborted();
  const counts = {
    downloadedCount: downloaded.files.filter((file) => file.status === "downloaded").length,
    existingCount: downloaded.files.filter((file) => file.status === "existing").length,
    failedCount: downloaded.files.filter((file) => file.status === "failed").length,
    skippedCount: downloaded.files.filter((file) => file.status === "not-video" || file.status === "missing-url").length,
  };
  progress({ phase: "writing", processed: videos.length, ...counts });
  const filePath = await appStore.exportVideos(downloaded.videos);
  signal.throwIfAborted();
  const platform = videos[0]?.platform ?? "douyin";
  const manifestPath = await appStore.exportVideoManifest({ batchId, platform, videos: downloaded.videos, files: downloaded.files });
  signal.throwIfAborted();
  return { count: videos.length, batchId, filePath, manifestPath, ...counts };
};

export const exportJobs = new ExportJobManager(saveVideos);
