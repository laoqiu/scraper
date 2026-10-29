import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { applyVideoFilters, parseSelfProfile, parseUserDetailRaw, parseUserProfile, parseUsers, parseVideos } from "./parsers.js";
import { parseXiaohongshuDetailVideo, parseXiaohongshuFeedVideo, parseXiaohongshuNotesPage, parseXiaohongshuProfile, parseXiaohongshuUsersPage } from "./platform/xiaohongshu-parsers.js";

test("parseVideos normalizes search and profile response shapes", () => {
  const body = JSON.stringify({
    data: [{
      aweme_info: {
        aweme_id: "video-1",
        desc: "测试视频",
        create_time: 1_700_000_000,
        author: { nickname: "创作者", sec_uid: "sec-1", follower_count: 1234 },
        video: { duration: 65_000, cover: { url_list: ["https://example.com/cover.jpg"] } },
        statistics: { digg_count: 50, share_count: 3, collect_count: 4, comment_count: 5 },
        share_info: { share_url: "https://www.douyin.com/video/video-1" },
      },
    }],
  });
  const [video] = parseVideos(body);
  assert.equal(video.id, "video-1");
  assert.equal(video.durationMs, 65_000);
  assert.equal(video.author, "创作者");
  assert.equal(video.coverUrl, "https://example.com/cover.jpg");
});

test("parseUsers accepts nested user_list entries and de-duplicates users", () => {
  const body = JSON.stringify({
    data: [{
      user_list: [{ user_info: { uid: "uid-1", sec_uid: "sec-1", unique_id: "douyin-1", nickname: "用户一", follower_count: 10, aweme_count: 2 } }],
      user_info: { uid: "uid-1", sec_uid: "sec-1", nickname: "用户一" },
    }],
  });
  const users = parseUsers(body);
  assert.equal(users.length, 1);
  assert.equal(users[0].profileUrl, "https://www.douyin.com/user/sec-1");
});

test("applyVideoFilters filters duration and sorts by likes", () => {
  const items = parseVideos(JSON.stringify({ aweme_list: [
    { aweme_id: "short", create_time: 1_700_000_000, video: { duration: 30_000 }, statistics: { digg_count: 5 } },
    { aweme_id: "long", create_time: 1_700_000_000, video: { duration: 400_000 }, statistics: { digg_count: 100 } },
  ] }));
  const filtered = applyVideoFilters(items, { sort: "most-liked", publishTime: "all", duration: "long" });
  assert.deepEqual(filtered.map((item) => item.id), ["long"]);
});

test("parseSelfProfile returns key account information only for a successful response", () => {
  const account = parseSelfProfile(JSON.stringify({
    status_code: 0,
    user: {
      uid: "uid-self",
      sec_uid: "sec-self",
      unique_id: "douyin-self",
      nickname: "登录用户",
      signature: "简介",
      city: "杭州",
      bind_phone: "138****0000",
      gender: 1,
      avatar_thumb: { url_list: ["https://example.com/avatar.jpg"] },
      follower_count: 120,
      following_count: 20,
      aweme_count: 8,
    },
  }));
  assert.equal(account?.nickname, "登录用户");
  assert.equal(account?.douyinId, "douyin-self");
  assert.equal(account?.uniqueId, "douyin-self");
  assert.equal(account?.city, "杭州");
  assert.equal(account?.bindPhone, "138****0000");
  assert.equal(account?.gender, 1);
  assert.equal(account?.followingCount, 20);
  assert.equal(parseSelfProfile(JSON.stringify({ status_code: 8 })), undefined);
});

test("parse the supplied user detail response samples", async () => {
  const profileBody = await readFile(fileURLToPath(new URL("../../test_user.json", import.meta.url)), "utf8");
  const postsBody = await readFile(fileURLToPath(new URL("../../test_user_post.json", import.meta.url)), "utf8");
  const profile = parseUserProfile(profileBody);
  const rawPosts = parseUserDetailRaw(postsBody);
  assert.equal(profile?.nickname, "立秋✨(新人直播)");
  assert.equal(profile?.secUid, "MS4wLjABAAAAkmWzzUuYP4W6SBzU6GdbT8S4JCqRERLcq45clU00SwU");
  assert.ok(rawPosts.awemeList.length > 0);
  assert.equal((rawPosts.awemeList[0] as { aweme_id?: string }).aweme_id, "7264046997802356026");
});

test("parse the supplied Xiaohongshu response samples", async () => {
  const profileBody = await readFile(fileURLToPath(new URL("../../test_xhs_userinfo.json", import.meta.url)), "utf8");
  const notesBody = await readFile(fileURLToPath(new URL("../../test_xhs_notes.json", import.meta.url)), "utf8");
  const usersBody = await readFile(fileURLToPath(new URL("../../test_xhs_usersearch.json", import.meta.url)), "utf8");
  const profile = parseXiaohongshuProfile(profileBody);
  const notes = parseXiaohongshuNotesPage(notesBody);
  const users = parseXiaohongshuUsersPage(usersBody);
  assert.equal(profile?.nickname, "陈平安");
  assert.equal(profile?.redId, "1642782650");
  assert.equal(notes.items.length, 2);
  assert.equal(notes.items[0]?.platform, "xiaohongshu");
  assert.ok(notes.items[0]?.publishedAt);
  assert.equal(Number.isNaN(new Date(notes.items[0]?.publishedAt ?? "").getTime()), false);
  assert.equal(notes.items[1]?.type, "video");
  assert.equal(notes.hasMore, true);
  assert.equal(users.items.length, 4);
  assert.equal(users.items[1]?.nickname, "又又丸");
  assert.equal(users.hasMore, false);
});

test("selects the lowest-resolution Xiaohongshu feed video", () => {
  const body = JSON.stringify({
    data: {
      items: [{
        id: "note-1",
        note_card: {
          video: {
            media: {
              stream: {
                h264: [
                  { width: 1080, height: 1920, master_url: "https://video.example/high.mp4" },
                  { width: 720, height: 1280, master_url: "https://video.example/low.mp4" },
                ],
              },
            },
          },
        },
      }],
    },
  });
  assert.equal(parseXiaohongshuFeedVideo(body, "note-1"), "https://video.example/low.mp4");
});

test("prefers a playable Xiaohongshu detail MP4 with audio", () => {
  const mediaV2 = JSON.stringify({
    stream: {
      EF5: [{ width: 1280, height: 720, format: "fmp4", master_url: "http://video.example/video.m4s" }],
      EF4: [{ width: 1280, height: 720, format: "mp4", audio_codec: "aac", audio_bitrate: 64_000, master_url: "http://video.example/video.mp4" }],
    },
  });
  assert.equal(parseXiaohongshuDetailVideo(mediaV2), "https://video.example/video.mp4");
});
