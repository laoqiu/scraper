import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { VideoDownloader } from "./browser/video-downloader.js";
import { appStore } from "./store.js";
import type { DouyinVideo } from "./types.js";
import type { ExportProgress } from "../export-model.js";

const video = (id: string, extra: Partial<DouyinVideo> = {}): DouyinVideo => ({
  id, title: id, platform: "douyin", author: "作者", secUid: "author", followerCount: 0,
  publishedAt: "2026-10-29", durationMs: 1000, type: "video", likes: 0, shares: 0, favorites: 0, comments: 0,
  url: "https://www.douyin.com/video/test", ...extra,
});

test("downloads publish real per-item progress across downloaded, existing, skipped, and failed files", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scraper-download-"));
  t.mock.method(appStore, "loadPlatformAccount", async () => undefined);
  t.mock.method(appStore, "videoFilePath", (_platform: string, id: string) => path.join(directory, `${id}.mp4`));
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([1, 2, 3])));
  const progress: ExportProgress[] = [];
  try {
    await fs.writeFile(path.join(directory, "existing.mp4"), "fixture");
    const saved = await new VideoDownloader().download([
      video("downloaded", { playUrl: "https://v3-web.douyinvod.com/fixture.mp4" }),
      video("existing"), video("image", { type: "image-text", platform: "xiaohongshu" }),
      video("missing", { platform: "xiaohongshu" }),
      video("failed", { playUrl: "https://unsupported.example/fixture.mp4" }),
    ], { onProgress: (value) => progress.push(value) });
    assert.deepEqual(saved.files.map((file) => file.status), ["downloaded", "existing", "not-video", "missing-url", "failed"]);
    assert.deepEqual([...await fs.readFile(path.join(directory, "downloaded.mp4"))], [1, 2, 3]);
    assert.equal(progress[0]?.currentTitle, "downloaded");
    assert.deepEqual(progress.at(-1), { phase: "downloading", processed: 5, currentTitle: undefined,
      downloadedCount: 1, existingCount: 1, failedCount: 1, skippedCount: 2 });
    assert.equal((await fs.readdir(directory)).some((file) => file.endsWith(".tmp")), false);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("cancelling a download removes its temporary file and stops later items", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scraper-cancel-"));
  const controller = new AbortController();
  let started!: () => void;
  const fetching = new Promise<void>((resolve) => { started = resolve; });
  t.mock.method(appStore, "loadPlatformAccount", async () => undefined);
  t.mock.method(appStore, "videoFilePath", (_platform: string, id: string) => path.join(directory, `${id}.mp4`));
  const fetchMock = t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    started();
    await new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
    return new Response();
  });
  try {
    const pending = new VideoDownloader().download([video("one", { playUrl: "https://v3-web.douyinvod.com/one.mp4" }), video("two")], { signal: controller.signal });
    const rejected = assert.rejects(pending, /用户取消/);
    await fetching;
    controller.abort(new Error("用户取消"));
    await rejected;
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.deepEqual(await fs.readdir(directory), []);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
