import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppStore } from "./store.js";
import type { DouyinAccount, VideoCollectionResult } from "./types.js";

test("account persistence keeps profile fields when login becomes invalid", async () => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "douyin-account-"));
  const previousDataDirectory = process.env.DOUYIN_DATA_DIR;
  process.env.DOUYIN_DATA_DIR = dataDirectory;

  let store: AppStore | undefined;
  try {
    store = new AppStore();
    const account: DouyinAccount = {
      uid: "uid-self",
      secUid: "sec-self",
      douyinId: "creator-id",
      uniqueId: "creator-id",
      nickname: "登录用户",
      signature: "简介",
      city: "杭州",
      bindPhone: "138****0000",
      gender: 1,
      avatarUrl: "https://example.com/avatar.jpg",
      followerCount: 120,
      followingCount: 20,
      videoCount: 8,
    };

    await store.saveLoginAccount(account, "sessionid=test-session", "test-user-agent");
    const authenticated = await store.loadLoginAccount();
    assert.deepEqual(authenticated, {
      status: 1,
      cookie: "sessionid=test-session",
      user_agent: "test-user-agent",
      avatar: "https://example.com/avatar.jpg",
      follower_count: 120,
      following_count: 20,
      nickname: "登录用户",
      uid: "uid-self",
      city: "杭州",
      bind_phone: "138****0000",
      signature: "简介",
      gender: 1,
      unique_id: "creator-id",
    });

    await store.markLoginAccountInvalid();
    const invalid = await store.loadLoginAccount();
    assert.deepEqual(invalid, { ...authenticated, status: 2 });
  } finally {
    await store?.close();
    if (previousDataDirectory === undefined) delete process.env.DOUYIN_DATA_DIR;
    else process.env.DOUYIN_DATA_DIR = previousDataDirectory;
    await fs.rm(dataDirectory, { recursive: true, force: true });
  }
});

test("sqlite persists metadata while collection payloads live in JSON results", async () => {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "douyin-videos-"));
  const previousDataDirectory = process.env.DOUYIN_DATA_DIR;
  process.env.DOUYIN_DATA_DIR = dataDirectory;

  let store: AppStore | undefined;
  let restoredCollection: AppStore | undefined;
  try {
    store = new AppStore();
    const result: VideoCollectionResult = {
      kind: "videos",
      jobId: "job-1",
      keyword: "测试",
      filters: { sort: "general", publishTime: "all", duration: "all", searchScope: "all", contentType: "all" },
      items: [{
        id: "video-1",
        title: "测试视频",
        author: "作者",
        secUid: "sec-1",
        followerCount: 1,
        publishedAt: "2026-09-19",
        durationMs: 1_000,
        type: "video",
        likes: 20,
        shares: 0,
        favorites: 2,
        comments: 3,
        url: "https://www.douyin.com/video/video-1",
      }],
      collectedAt: new Date().toISOString(),
      pages: 1,
      hasMore: false,
    };

    await store.update({ lastVideos: result });
    await store.update({ lastVideoSearch: { keyword: "测试", maxPages: 10, filters: result.filters } });
    assert.equal((await fs.stat(path.join(dataDirectory, "douyin.db"))).isFile(), true);
    assert.deepEqual((await fs.readdir(dataDirectory)).filter((name) => name.endsWith(".json")), []);
    assert.equal((await fs.readdir(path.join(dataDirectory, "results", "videos"))).length, 1);
    restoredCollection = new AppStore();
    await restoredCollection.initialize();
    assert.deepEqual(restoredCollection.snapshot().lastVideos, result);

  } finally {
    await restoredCollection?.close();
    await store?.close();
    if (previousDataDirectory === undefined) delete process.env.DOUYIN_DATA_DIR;
    else process.env.DOUYIN_DATA_DIR = previousDataDirectory;
    await fs.rm(dataDirectory, { recursive: true, force: true });
  }
});
