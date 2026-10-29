import { randomUUID } from "node:crypto";
import type { ExportJob, ExportProgress, VideoExportResult } from "../export-model.js";
import type { DouyinVideo } from "./types.js";

export type ExportRunner = (videos: DouyinVideo[], signal: AbortSignal, progress: (value: ExportProgress) => void) => Promise<VideoExportResult>;
type Entry = { job: ExportJob; controller: AbortController; finishedAt?: number };

/** Process-owned jobs. Each caller keeps its own ID; completed records expire after an hour. */
export class ExportJobManager {
  private entries = new Map<string, Entry>();
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly run: ExportRunner) {}

  start(videos: DouyinVideo[]): ExportJob {
    if (this.closed) throw new Error("保存服务正在关闭");
    if (!videos.length) throw new Error("请先选择要保存的数据");
    this.prune();
    if (this.entries.size >= 100) throw new Error("保存任务过多，请稍后重试");
    const input = structuredClone(videos);
    const entry: Entry = {
      controller: new AbortController(),
      job: { kind: "videos-export-job", platform: input[0]?.platform ?? "douyin", exportId: randomUUID(), status: "queued", phase: "queued", total: input.length,
        processed: 0, downloadedCount: 0, existingCount: 0, failedCount: 0, skippedCount: 0 },
    };
    this.entries.set(entry.job.exportId, entry);
    // Serialize writes and browser navigation, including overlapping exports from different views.
    this.queue = this.queue.then(async () => {
      if (entry.controller.signal.aborted) return;
      entry.job.status = "running";
      try {
        const result = await this.run(input, entry.controller.signal, (progress) => {
          if (!entry.controller.signal.aborted) Object.assign(entry.job, progress);
        });
        entry.controller.signal.throwIfAborted();
        Object.assign(entry.job, { status: "completed", result, processed: input.length, currentTitle: undefined,
          downloadedCount: result.downloadedCount, existingCount: result.existingCount,
          failedCount: result.failedCount, skippedCount: result.skippedCount });
      } catch (error) {
        entry.job.status = entry.controller.signal.aborted ? "cancelled" : "failed";
        entry.job.error = error instanceof Error ? error.message : String(error);
      } finally {
        entry.finishedAt = Date.now();
      }
    });
    return structuredClone(entry.job);
  }

  get(exportId: string): ExportJob {
    this.prune();
    const entry = this.entries.get(exportId);
    if (!entry) throw new Error("保存任务不存在或已过期；服务重启后任务不会恢复，请重新保存");
    return structuredClone(entry.job);
  }

  abort(): void {
    this.closed = true;
    for (const entry of this.entries.values()) {
      if (entry.job.status !== "queued" && entry.job.status !== "running") continue;
      entry.controller.abort(new Error("服务已关闭，保存任务已取消"));
      entry.job.status = "cancelled";
      entry.job.error = "服务已关闭，保存任务已取消";
      entry.finishedAt = Date.now();
    }
  }

  async close(): Promise<void> {
    this.abort();
    await this.queue;
  }

  private prune(): void {
    for (const [id, entry] of this.entries) {
      if (entry.finishedAt && (Date.now() - entry.finishedAt > 3_600_000 || this.entries.size >= 100)) this.entries.delete(id);
    }
  }
}
