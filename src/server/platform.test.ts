import assert from "node:assert/strict";
import test from "node:test";
import { detectPlatformByMediaUrl, listPlatformAdapters } from "./platform/adapters.js";

test("scraper registers one media adapter per supported platform", () => {
  assert.deepEqual(listPlatformAdapters().map((adapter) => adapter.id), ["douyin", "kuaishou", "xiaohongshu"]);
  assert.equal(detectPlatformByMediaUrl("https://v3-web.douyinvod.com/example.mp4")?.id, "douyin");
  assert.equal(detectPlatformByMediaUrl("https://cdn.kwimgs.com/example.mp4")?.id, "kuaishou");
  assert.equal(detectPlatformByMediaUrl("https://sns-video.xhscdn.com/example.mp4")?.id, "xiaohongshu");
  assert.equal(detectPlatformByMediaUrl("http://untrusted.example/video.mp4"), undefined);
});
