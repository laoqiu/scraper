import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { DouyinUser, DouyinVideo, VideoFileRecord } from "./types.js";
import { csvEscape } from "./store-helpers.js";

async function writeExport(root: string, filename: string, content: string): Promise<string> {
  const target = path.join(root, filename);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  return target;
}

export function exportUsers(root: string, users: DouyinUser[]): Promise<string> {
  const rows = ["uid,sec_uid,抖音号,昵称,签名,头像,粉丝数,获赞数,作品数,主页地址"];
  for (const user of users) {
    rows.push([
      user.uid, user.sec_uid || user.secUid, user.douyinId, user.nickname, user.signature, user.avatarUrl ?? "",
      user.followerCount, user.totalFavorited, user.videoCount, user.profileUrl,
    ].map(csvEscape).join(","));
  }
  return writeExport(root, `users_${Date.now()}.csv`, `\uFEFF${rows.join("\r\n")}\r\n`);
}

export function exportVideos(root: string, videos: DouyinVideo[]): Promise<string> {
  const rows = ["视频ID,标题,作者,类型,发布时间,时长毫秒,点赞数,收藏数,评论数,转发数,视频地址,封面地址,播放地址,本地视频地址,下载状态"];
  for (const video of videos) {
    rows.push([
      video.id, video.title, video.author, video.type === "video" ? "视频" : "图文", video.publishedAt, video.durationMs,
      video.likes, video.favorites, video.comments, video.shares, video.url, video.coverUrl ?? "", video.playUrl ?? "", video.localPath ?? "", video.downloadStatus ?? "",
    ].map(csvEscape).join(","));
  }
  return writeExport(root, `videos_${Date.now()}_${randomUUID()}.csv`, `\uFEFF${rows.join("\r\n")}\r\n`);
}

export function exportVideoManifest(root: string, input: {
  batchId: string;
  platform: "douyin" | "kuaishou" | "xiaohongshu";
  videos: DouyinVideo[];
  files: VideoFileRecord[];
}): Promise<string> {
  const payload = {
    version: 1,
    kind: "video-manifest",
    batchId: input.batchId,
    platform: input.platform,
    createdAt: new Date().toISOString(),
    items: input.videos.map((video) => ({
      id: video.id,
      title: video.title,
      author: video.author,
      type: video.type,
      durationMs: video.durationMs,
      likes: video.likes,
      favorites: video.favorites,
      comments: video.comments,
      shares: video.shares,
      sourceUrl: video.url,
      playUrl: video.playUrl,
      localPath: video.localPath,
      downloadStatus: video.downloadStatus,
    })),
    files: input.files,
  };
  return writeExport(root, `video-manifests/videos_${Date.now()}_${randomUUID()}.json`, `${JSON.stringify(payload, null, 2)}\n`);
}
