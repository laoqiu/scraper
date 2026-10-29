import { z } from "zod";

const count = z.number().int().nonnegative();
export const exportResultSchema = z.object({
  count, filePath: z.string(), manifestPath: z.string(), batchId: z.string(),
  downloadedCount: count, existingCount: count, failedCount: count, skippedCount: count,
});
export const exportJobSchema = z.object({
  kind: z.literal("videos-export-job"), platform: z.enum(["douyin", "kuaishou", "xiaohongshu"]), exportId: z.string(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  phase: z.enum(["queued", "downloading", "writing"]),
  total: count, processed: count,
  downloadedCount: count, existingCount: count, failedCount: count, skippedCount: count,
  currentTitle: z.string().optional(), error: z.string().optional(),
  result: exportResultSchema.optional(),
});
export type VideoExportResult = z.infer<typeof exportResultSchema>;
export type ExportJob = z.infer<typeof exportJobSchema>;
export type ExportProgress = Pick<ExportJob, "phase" | "processed" | "downloadedCount" | "existingCount" | "failedCount" | "skippedCount" | "currentTitle">;
export const EXPORT_POLL_INTERVAL_MS = 1_000;
export const exportInProgress = (job?: ExportJob) => job?.status === "queued" || job?.status === "running";
