import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { ExportJobManager } from "./export-jobs.js";
import { exportJobSchema, type VideoExportResult } from "../export-model.js";
import type { DouyinVideo } from "./types.js";

const videos = [{ id: "one", title: "原始标题", type: "image-text", platform: "xiaohongshu" }] as DouyinVideo[];
const result: VideoExportResult = { count: 1, filePath: "test.csv", manifestPath: "manifest.json", batchId: "batch",
  downloadedCount: 0, existingCount: 0, failedCount: 0, skippedCount: 1 };

test("exports return immediately, keep independent snapshots, and serialize queued jobs", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const inputs: DouyinVideo[][] = [];
  const manager = new ExportJobManager(async (input, _signal, progress) => {
    inputs.push(input);
    progress({ phase: "downloading", processed: 0, currentTitle: input[0]?.title, downloadedCount: 0, existingCount: 0, failedCount: 0, skippedCount: 0 });
    await gate;
    return result;
  });
  const source = structuredClone(videos);
  const first = manager.start(source);
  const second = manager.start(videos);
  source[0]!.title = "后来修改";
  assert.equal(first.status, "queued");
  assert.notEqual(first.exportId, second.exportId);
  await setImmediate();
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0]?.[0]?.title, "原始标题");
  assert.equal(manager.get(second.exportId).status, "queued");
  const snapshot = manager.get(first.exportId);
  assert.equal(snapshot.currentTitle, "原始标题");
  snapshot.processed = 999;
  assert.equal(manager.get(first.exportId).processed, 0);
  release();
  await setImmediate();
  assert.equal(inputs.length, 2);
  const completed = exportJobSchema.parse(manager.get(first.exportId));
  assert.equal(completed.status, "completed");
  assert.equal(completed.result?.skippedCount, 1);
  assert.equal(completed.processed, 1);
  assert.equal(completed.platform, "xiaohongshu");
  assert.equal(manager.get(second.exportId).status, "completed");
  await manager.close();
});

test("a failed export does not poison the queue or report a successful file", async () => {
  let calls = 0;
  const manager = new ExportJobManager(async () => { if (++calls === 1) throw new Error("磁盘写入失败"); return result; });
  const first = manager.start(videos);
  const second = manager.start(videos);
  await setImmediate();
  assert.equal(manager.get(first.exportId).status, "failed");
  assert.equal(manager.get(first.exportId).error, "磁盘写入失败");
  assert.equal(manager.get(first.exportId).result, undefined);
  assert.equal(manager.get(second.exportId).status, "completed");
  assert.throws(() => manager.get("unknown"), /不存在或已过期/);
  await manager.close();
});

test("shutdown cancels active and queued jobs and ignores late completion", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  let signal: AbortSignal | undefined;
  const manager = new ExportJobManager(async (_input, currentSignal, progress) => {
    calls++; signal = currentSignal;
    await gate;
    progress({ phase: "writing", processed: 1, downloadedCount: 0, existingCount: 0, failedCount: 0, skippedCount: 1 });
    return result;
  });
  const first = manager.start(videos), second = manager.start(videos);
  await setImmediate();
  const closing = manager.close();
  assert.equal(signal?.aborted, true);
  assert.equal(manager.get(first.exportId).status, "cancelled");
  assert.equal(manager.get(second.exportId).status, "cancelled");
  release();
  await closing;
  assert.equal(calls, 1);
  assert.equal(manager.get(first.exportId).result, undefined);
  assert.equal(manager.get(first.exportId).processed, 0);
  assert.throws(() => manager.start(videos), /正在关闭/);
});
