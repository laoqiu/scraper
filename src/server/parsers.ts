import type { DouyinAccount, DouyinUser, DouyinVideo, VideoFilters } from "./types.js";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0;
}

function firstUrl(value: unknown): string | undefined {
  const source = record(value);
  const urls = array(source.url_list);
  const candidate = urls.find((url) => typeof url === "string");
  return typeof candidate === "string" ? candidate : undefined;
}

function parseJsonFrames(body: string): unknown[] {
  try {
    return [JSON.parse(body) as unknown];
  } catch {
    const frames: unknown[] = [];
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
      try {
        frames.push(JSON.parse(trimmed) as unknown);
      } catch {
        // Ignore incomplete streaming frames.
      }
    }
    return frames;
  }
}

function normalizeVideo(raw: unknown): DouyinVideo | undefined {
  const aweme = record(raw);
  const id = text(aweme.aweme_id);
  if (!id) return undefined;
  const author = record(aweme.author);
  const video = record(aweme.video);
  const statistics = record(aweme.statistics);
  const shareInfo = record(aweme.share_info);
  const cover = record(video.cover);
  const durationMs = number(video.duration);
  const awemeType = number(aweme.aweme_type);
  const shareUrl = text(shareInfo.share_url) || text(aweme.share_url) || `https://www.douyin.com/video/${id}`;
  return {
    id,
    platform: "douyin",
    awemeType,
    title: text(aweme.desc),
    author: text(author.nickname),
    secUid: text(author.sec_uid),
    followerCount: number(author.follower_count),
    publishedAt: number(aweme.create_time)
      ? new Date(number(aweme.create_time) * 1000).toISOString()
      : "",
    durationMs,
    type: awemeType === 68 || array(aweme.images).length > 0 || array(aweme.image_infos).length > 0 ? "image-text" : "video",
    likes: number(statistics.digg_count),
    shares: number(statistics.share_count),
    favorites: number(statistics.collect_count),
    comments: number(statistics.comment_count),
    url: shareUrl,
    coverUrl: firstUrl(cover),
    playUrl: firstUrl(video.play_addr),
  };
}

function collectAwemeCandidates(frame: unknown): unknown[] {
  const root = record(frame);
  const candidates: unknown[] = [...array(root.aweme_list)];
  for (const item of array(root.data)) {
    const entry = record(item);
    if (entry.aweme_info) candidates.push(entry.aweme_info);
    if (entry.aweme) candidates.push(entry.aweme);
  }
  return candidates;
}

export interface ParsedVideoPage {
  items: DouyinVideo[];
  hasMore?: boolean;
}

export interface ParsedUserPage {
  items: DouyinUser[];
  hasMore?: boolean;
}

function parseHasMore(value: unknown): boolean | undefined {
  if (value === 0 || value === "0") return false;
  if (value === 1 || value === "1") return true;
  return undefined;
}

export function parseVideoPage(body: string): ParsedVideoPage {
  const videos = new Map<string, DouyinVideo>();
  let hasMore: boolean | undefined;
  for (const frame of parseJsonFrames(body)) {
    const root = record(frame);
    const parsedHasMore = parseHasMore(root.has_more);
    if (parsedHasMore === false) hasMore = false;
    else if (parsedHasMore === true && hasMore === undefined) hasMore = true;
    for (const raw of collectAwemeCandidates(frame)) {
      const video = normalizeVideo(raw);
      if (video) videos.set(video.id, video);
    }
  }
  return { items: [...videos.values()], hasMore };
}

export function parseVideos(body: string): DouyinVideo[] {
  return parseVideoPage(body).items;
}

function normalizeUser(raw: unknown): DouyinUser | undefined {
  const user = record(raw);
  const uid = text(user.uid);
  const secUid = text(user.sec_uid);
  if (!uid && !secUid) return undefined;
  const douyinId = text(user.unique_id) || text(user.short_id);
  const avatarUrl = firstUrl(user.avatar_medium) || firstUrl(user.avatar_thumb);
  return {
    uid,
    secUid,
    sec_uid: secUid,
    secret: number(user.secret),
    douyinId,
    nickname: text(user.nickname),
    signature: text(user.signature),
    avatarUrl,
    followerCount: number(user.follower_count) || number(user.max_follower_count),
    totalFavorited: number(user.total_favorited),
    videoCount: number(user.aweme_count),
    profileUrl: secUid ? `https://www.douyin.com/user/${encodeURIComponent(secUid)}` : "",
  };
}

function collectUserCandidates(frame: unknown): unknown[] {
  const root = record(frame);
  const candidates: unknown[] = [];
  const visit = (value: unknown): void => {
    const entry = record(value);
    if (entry.user_info) candidates.push(entry.user_info);
    if (entry.user) candidates.push(entry.user);
    for (const nested of array(entry.user_list)) visit(nested);
  };
  for (const item of array(root.data)) visit(item);
  for (const item of array(root.user_list)) visit(item);
  return candidates;
}

export function parseUserPage(body: string): ParsedUserPage {
  const users = new Map<string, DouyinUser>();
  let hasMore: boolean | undefined;
  for (const frame of parseJsonFrames(body)) {
    const root = record(frame);
    const parsedHasMore = parseHasMore(root.has_more);
    if (parsedHasMore === false) hasMore = false;
    else if (parsedHasMore === true && hasMore === undefined) hasMore = true;
    for (const raw of collectUserCandidates(frame)) {
      const user = normalizeUser(raw);
      if (user) {
        const key = user.secUid || user.uid;
        const previous = users.get(key);
        // Search responses can contain the same user at multiple nesting
        // levels. Preserve the private-account marker if any copy has it.
        users.set(key, previous?.secret === 1 || user.secret === 1 ? { ...user, secret: 1 } : user);
      }
    }
  }
  return { items: [...users.values()], hasMore };
}

export function parseUsers(body: string): DouyinUser[] {
  return parseUserPage(body).items;
}

/** Parse the creator profile returned by the user profile endpoints. */
export function parseUserProfile(body: string): DouyinUser | undefined {
  for (const frame of parseJsonFrames(body)) {
    const root = record(frame);
    if (number(root.status_code) !== 0) continue;
    const user = normalizeUser(root.user);
    if (user) return user;
  }
  return undefined;
}

export interface ParsedUserDetailRaw {
  author?: Record<string, unknown>;
  awemeList: unknown[];
  hasMore?: number;
}

/** Keep the original response fields for the per-creator cache file. */
export function parseUserDetailRaw(body: string): ParsedUserDetailRaw {
  let author: Record<string, unknown> | undefined;
  const awemeList: unknown[] = [];
  let hasMore: number | undefined;
  for (const frame of parseJsonFrames(body)) {
    const root = record(frame);
    if (!author && root.user && typeof root.user === "object" && !Array.isArray(root.user)) {
      author = root.user as Record<string, unknown>;
    }
    if (root.has_more === 0 || root.has_more === 1) hasMore = root.has_more;
    for (const item of array(root.aweme_list)) awemeList.push(item);
    for (const item of array(root.data)) {
      const entry = record(item);
      if (entry.aweme_info) awemeList.push(entry.aweme_info);
      else if (entry.aweme) awemeList.push(entry.aweme);
    }
  }
  return { author, awemeList, hasMore };
}

export function parseSelfProfile(body: string): DouyinAccount | undefined {
  for (const frame of parseJsonFrames(body)) {
    const root = record(frame);
    if (number(root.status_code) !== 0) continue;
    const user = record(root.user);
    const uid = text(user.uid);
    const secUid = text(user.sec_uid);
    if (!uid && !secUid) continue;
    return {
      uid,
      secUid,
      douyinId: text(user.unique_id) || text(user.short_id),
      uniqueId: text(user.unique_id),
      nickname: text(user.nickname),
      signature: text(user.signature),
      city: text(user.city),
      bindPhone: text(user.bind_phone),
      gender: number(user.gender),
      avatarUrl: firstUrl(user.avatar_medium) || firstUrl(user.avatar_thumb),
      followerCount: number(user.follower_count) || number(user.max_follower_count),
      followingCount: number(user.following_count),
      videoCount: number(user.aweme_count),
    };
  }
  return undefined;
}

export function applyVideoFilters(items: DouyinVideo[], filters: VideoFilters): DouyinVideo[] {
  const now = Date.now();
  const filtered = items.filter((item) => {
    if (filters.duration === "short" && item.durationMs >= 60_000) return false;
    if (filters.duration === "medium" && (item.durationMs < 60_000 || item.durationMs >= 300_000)) return false;
    if (filters.duration === "long" && item.durationMs < 300_000) return false;
    if (filters.publishTime !== "all" && item.publishedAt) {
      const age = now - new Date(item.publishedAt).getTime();
      const limit = filters.publishTime === "day"
        ? 86_400_000
        : filters.publishTime === "week"
          ? 7 * 86_400_000
          : 183 * 86_400_000;
      if (age > limit) return false;
    }
    return true;
  });
  if (filters.sort === "latest") {
    filtered.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  } else if (filters.sort === "most-liked") {
    filtered.sort((a, b) => b.likes - a.likes);
  }
  return filtered;
}

export interface VideoThresholds {
  favoritesGt?: number;
  likesGt?: number;
  commentsGt?: number;
}

export function filterVideosByThresholds(items: DouyinVideo[], thresholds: VideoThresholds): DouyinVideo[] {
  return items.filter((item) =>
    (thresholds.favoritesGt === undefined || item.favorites > thresholds.favoritesGt)
    && (thresholds.likesGt === undefined || item.likes > thresholds.likesGt)
    && (thresholds.commentsGt === undefined || item.comments > thresholds.commentsGt),
  );
}
