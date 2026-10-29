import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { exportJobSchema, exportInProgress } from "../export-model.js";
import { AppStore } from "./store.js";
import type { DouyinVideo, PlatformId } from "./types.js";

test("both platform exports and the App export return jobs whose CSV and manifest match the selection", async () => {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scraper-export-mcp-"));
  const previousDirectory = process.env.DOUYIN_DATA_DIR;
  process.env.DOUYIN_DATA_DIR = directory;
  const store = new AppStore();
  if (previousDirectory === undefined) delete process.env.DOUYIN_DATA_DIR;
  else process.env.DOUYIN_DATA_DIR = previousDirectory;
  const fixture = (platform: PlatformId): DouyinVideo => ({
    platform, id: `${platform}-selected`, title: `${platform} 测试图文`, author: "作者", secUid: "author", followerCount: 0,
    publishedAt: "2026-10-29", durationMs: 0, type: "image-text", likes: 1, shares: 0, favorites: 0, comments: 0,
    url: "https://example.com/fixture",
  });
  const client = new Client({ name: "export-test", version: "0.1.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(packageRoot, "dist", "main.js"), "--stdio"],
    cwd: packageRoot, stderr: "pipe", env: { DOUYIN_DATA_DIR: directory } });
  try {
    for (const platform of ["douyin", "xiaohongshu"] as const) {
      await store.update({ lastVideos: { kind: "videos", jobId: `${platform}-job`, platform, keyword: "测试",
        filters: { sort: "general", publishTime: "all", duration: "all" },
        collectedAt: new Date().toISOString(), items: [fixture(platform), { ...fixture(platform), id: "not-selected", title: "未勾选内容" }] } });
    }
    await store.close();
    await client.connect(transport);
    const jobs = [];
    for (const platform of ["douyin", "xiaohongshu"] as const) {
      const response = await client.callTool({ name: `${platform}.export_videos`, arguments: { jobId: `${platform}-job`, ids: [fixture(platform).id] } });
      assert.notEqual(response.isError, true);
      const job = exportJobSchema.parse(response.structuredContent);
      assert.equal(job.status, "queued");
      assert.equal(job.total, 1);
      assert.equal(job.result, undefined);
      assert.equal(job.platform, platform);
      const url = new URL(String((response.structuredContent as { appUrl?: string }).appUrl));
      assert.equal(url.searchParams.get("exportId"), job.exportId);
      if (platform === "xiaohongshu") assert.match(url.pathname, /xiaohongshu/);
      jobs.push(job);
    }
    const appResponse = await client.callTool({ name: "state.export_videos", arguments: { videos: [fixture("xiaohongshu")] } });
    jobs.push(exportJobSchema.parse(appResponse.structuredContent));
    assert.equal(new Set(jobs.map((job) => job.exportId)).size, 3);
    const csvPaths = new Set<string>(), manifestPaths = new Set<string>();
    for (let job of jobs) {
      const deadline = Date.now() + 10_000;
      while (exportInProgress(job) && Date.now() < deadline) {
        const response = await client.callTool({ name: "state.get_export", arguments: { exportId: job.exportId } });
        assert.notEqual(response.isError, true);
        job = exportJobSchema.parse(response.structuredContent);
        if (exportInProgress(job)) await setTimeout(10);
      }
      assert.equal(job.status, "completed", job.error);
      assert.equal(job.processed, 1);
      assert.equal(job.result?.count, 1);
      assert.equal(job.result?.skippedCount, 1);
      csvPaths.add(job.result!.filePath);
      manifestPaths.add(job.result!.manifestPath);
      const csv = await fs.readFile(job.result!.filePath, "utf8");
      assert.match(csv, /测试图文/);
      assert.doesNotMatch(csv, /未勾选内容/);
      const manifest = JSON.parse(await fs.readFile(job.result!.manifestPath, "utf8"));
      assert.equal(manifest.platform, job.platform);
      assert.equal(manifest.items.length, 1);
      assert.equal(manifest.items[0].downloadStatus, "not-video");
    }
    assert.equal(csvPaths.size, 3);
    assert.equal(manifestPaths.size, 3);
    const missing = await client.callTool({ name: "state.get_export", arguments: { exportId: "00000000-0000-4000-8000-000000000000" } });
    assert.equal(missing.isError, true);
    const empty = await client.callTool({ name: "state.export_videos", arguments: { videos: [] } });
    assert.equal(empty.isError, true);
  } finally {
    await store.close();
    await client.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
