import type { DouyinAccount, DouyinUser, DouyinVideo, VideoFilters } from "../types.js";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const normalized = value.trim().replaceAll(",", "");
  const parsed = Number(normalized.replace(/[万亿]$/, ""));
  if (!Number.isFinite(parsed)) return 0;
  if (normalized.endsWith("万")) return Math.round(parsed * 10_000);
  if (normalized.endsWith("亿")) return Math.round(parsed * 100_000_000);
  return parsed;
}

function dateFromTimestamp(value: number): Date | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const milliseconds = value < 1_000_000_000_000 ? value * 1_000 : value;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizePublishedAt(value: unknown): string {
  if (typeof value === "number") return dateFromTimestamp(value)?.toISOString() ?? "";
  if (typeof value !== "string") return "";
  const source = value.trim();
  if (!source) return "";

  const numeric = /^\d{10,13}$/.test(source) ? dateFromTimestamp(Number(source)) : undefined;
  if (numeric) return numeric.toISOString();

  const now = new Date();
  const relative = source.match(/^(\d+)\s*(秒|分钟|小时|天|周|月|年)前$/);
  if (source === "刚刚" || relative) {
    const date = new Date(now);
    if (relative) {
      const amount = Number(relative[1]);
      switch (relative[2]) {
        case "秒": date.setSeconds(date.getSeconds() - amount); break;
        case "分钟": date.setMinutes(date.getMinutes() - amount); break;
        case "小时": date.setHours(date.getHours() - amount); break;
        case "天": date.setDate(date.getDate() - amount); break;
        case "周": date.setDate(date.getDate() - amount * 7); break;
        case "月": date.setMonth(date.getMonth() - amount); break;
        case "年": date.setFullYear(date.getFullYear() - amount); break;
      }
    }
    return date.toISOString();
  }
  if (source === "昨天" || source === "前天") {
    const date = new Date(now);
    date.setDate(date.getDate() - (source === "昨天" ? 1 : 2));
    return date.toISOString();
  }

  const monthDay = source.match(/^(\d{1,2})[-/]([0-9]{1,2})$/) ?? source.match(/^(\d{1,2})月(\d{1,2})日?$/);
  if (monthDay) {
    const month = Number(monthDay[1]);
    const day = Number(monthDay[2]);
    const date = new Date(now.getFullYear(), month - 1, day);
    if (date.getMonth() !== month - 1 || date.getDate() !== day) return "";
    if (date.getTime() > now.getTime()) date.setFullYear(date.getFullYear() - 1);
    return date.toISOString();
  }

  const date = new Date(source.replaceAll(".", "-"));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function firstUrl(value: unknown): string | undefined {
  const source = record(value);
  const urls = array(source.url_list);
  const candidate = urls.find((item) => typeof item === "string");
  if (typeof candidate === "string") return candidate.replace(/^http:\/\//, "https://");
  for (const key of ["url_default", "url_pre", "url", "master_url", "play_url", "origin_video_url"]) {
    const item = source[key];
    if (typeof item === "string" && item) return item.replace(/^http:\/\//, "https://");
  }
  return undefined;
}

type MediaCandidate = { url: string; resolution: number; order: number };
type PlayableMediaCandidate = MediaCandidate & { format: string; hasAudio: boolean };

function mediaResolution(value: JsonRecord, inherited = Number.POSITIVE_INFINITY): number {
  const width = number(value.width) || number(value.video_width) || number(value.videoWidth);
  const height = number(value.height) || number(value.video_height) || number(value.videoHeight);
  if (width > 0 && height > 0) return width * height;
  if (width > 0) return width;
  if (height > 0) return height;
  return inherited;
}

function collectMediaCandidates(value: unknown, inheritedResolution = Number.POSITIVE_INFINITY, output: MediaCandidate[] = [], order = { value: 0 }): MediaCandidate[] {
  if (Array.isArray(value)) {
    for (const item of value) collectMediaCandidates(item, inheritedResolution, output, order);
    return output;
  }
  if (typeof value !== "object" || value === null) return output;
  const source = record(value);
  const resolution = mediaResolution(source, inheritedResolution);
  const urlKeys = ["master_url", "url", "url_list", "avc_url", "video_url", "play_url", "main_url", "backup_urls"];
  for (const key of urlKeys) {
    const candidate = source[key];
    if (typeof candidate === "string" && /^https?:\/\//.test(candidate)) {
      output.push({ url: candidate.replace(/^http:\/\//, "https://"), resolution, order: order.value++ });
    } else if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (typeof item === "string" && /^https?:\/\//.test(item)) {
          output.push({ url: item.replace(/^http:\/\//, "https://"), resolution, order: order.value++ });
        } else {
          collectMediaCandidates(item, resolution, output, order);
        }
      }
    } else if (candidate && typeof candidate === "object") {
      collectMediaCandidates(candidate, resolution, output, order);
    }
  }
  for (const [key, nested] of Object.entries(source)) {
    if (!urlKeys.includes(key)) collectMediaCandidates(nested, resolution, output, order);
  }
  return output;
}

function selectLowestResolutionVideoUrl(media: unknown): string | undefined {
  return collectMediaCandidates(media)
    .sort((left, right) => left.resolution - right.resolution || left.order - right.order)[0]?.url;
}

function collectPlayableMediaCandidates(value: unknown, inheritedResolution = Number.POSITIVE_INFINITY, output: PlayableMediaCandidate[] = [], order = { value: 0 }): PlayableMediaCandidate[] {
  if (Array.isArray(value)) {
    for (const item of value) collectPlayableMediaCandidates(item, inheritedResolution, output, order);
    return output;
  }
  if (typeof value !== "object" || value === null) return output;
  const source = record(value);
  const resolution = mediaResolution(source, inheritedResolution);
  const masterUrl = text(source.master_url) || text(source.url);
  if (/^https?:\/\//.test(masterUrl)) {
    output.push({
      url: masterUrl.replace(/^http:\/\//, "https://"),
      resolution,
      order: order.value++,
      format: text(source.format).toLowerCase(),
      hasAudio: Boolean(text(source.audio_codec)) || number(source.audio_bitrate) > 0 || number(source.audio_duration) > 0,
    });
  }
  for (const nested of Object.values(source)) collectPlayableMediaCandidates(nested, resolution, output, order);
  return output;
}

function selectPlayableVideoUrl(media: unknown): string | undefined {
  const candidates = collectPlayableMediaCandidates(media);
  const playableRank = (candidate: PlayableMediaCandidate): number => (
    candidate.format === "mp4" && candidate.hasAudio ? 0
      : candidate.format === "mp4" ? 1
        : 2
  );
  return candidates
    .sort((left, right) => playableRank(left) - playableRank(right) || left.resolution - right.resolution || left.order - right.order)
    .at(0)?.url;
}

function parseJson(body: string): JsonRecord {
  try {
    return record(JSON.parse(body));
  } catch {
    return {};
  }
}

function hasMore(value: unknown): boolean | undefined {
  if (value === false || value === 0 || value === "0") return false;
  if (value === true || value === 1 || value === "1") return true;
  return undefined;
}

function noteItems(root: JsonRecord): JsonRecord[] {
  const data = record(root.data);
  return [...array(data.items), ...array(data.notes)].map((item) => record(item));
}

function normalizeNote(item: JsonRecord): DouyinVideo | undefined {
  const note = Object.keys(record(item.note_card)).length
    ? record(item.note_card)
    : Object.keys(record(item.note)).length ? record(item.note) : item;
  const id = text(item.id) || text(note.note_id) || text(note.noteId);
  if (!id) return undefined;
  const author = record(note.user);
  const stats = record(note.interact_info);
  const cover = record(note.cover);
  const image = record(array(note.image_list)[0]);
  const imageInfo = record(array(image.info_list).find((entry) => text(record(entry).image_scene) === "WB_DFT") ?? array(image.info_list)[0]);
  const video = record(note.video);
  const videoUrl = firstUrl(video) || firstUrl(record(video.media));
  const token = text(item.xsec_token) || text(note.xsec_token);
  const url = `https://www.xiaohongshu.com/explore/${id}${token ? `?xsec_token=${encodeURIComponent(token)}` : ""}`;
  const duration = number(video.duration);
  const publishTag = array(note.corner_tag_info)
    .map((value) => record(value))
    .find((value) => text(value.type) === "publish_time");
  const publishedAt = normalizePublishedAt(
    publishTag?.text
      ?? note.create_time
      ?? note.createTime
      ?? note.publish_time
      ?? note.publishTime,
  );
  return {
    id,
    platform: "xiaohongshu",
    title: text(note.display_title) || text(note.title),
    author: text(author.nickname) || text(author.nick_name),
    secUid: text(author.user_id),
    followerCount: 0,
    publishedAt,
    durationMs: duration > 0 && duration < 1_000 ? duration * 1_000 : duration,
    type: text(note.type) === "video" ? "video" : "image-text",
    likes: number(stats.liked_count),
    shares: number(stats.shared_count),
    favorites: number(stats.collected_count),
    comments: number(stats.comment_count),
    url,
    coverUrl: firstUrl(cover) || firstUrl(imageInfo),
    // The search response may not contain the stream. Keep the token so the
    // App can open the detail page and resolve the stream on demand.
    playUrl: videoUrl,
    xsecToken: token || undefined,
  };
}

export interface ParsedXiaohongshuNotesPage {
  items: DouyinVideo[];
  hasMore?: boolean;
}

export function parseXiaohongshuNotesPage(body: string): ParsedXiaohongshuNotesPage {
  const root = parseJson(body);
  const items = new Map<string, DouyinVideo>();
  for (const item of noteItems(root)) {
    const note = normalizeNote(item);
    if (note) items.set(note.id, note);
  }
  return { items: [...items.values()], hasMore: hasMore(record(root.data).has_more) };
}

export function parseXiaohongshuFeedVideo(body: string, noteId: string): string | undefined {
  const root = parseJson(body);
  const items = array(record(root.data).items);
  for (const item of items) {
    const entry = record(item);
    const note = record(entry.note_card);
    const id = text(entry.id) || text(note.note_id) || text(note.noteId);
    if (id !== noteId) continue;
    return selectLowestResolutionVideoUrl(record(note.video).media);
  }
  return undefined;
}

/**
 * The current note detail page embeds mediaV2 in __INITIAL_STATE__ instead of
 * requesting the historical /api/sns/web/v1/feed endpoint. Prefer an MP4
 * stream with audio so the local player can consume one URL directly.
 */
export function parseXiaohongshuDetailVideo(mediaV2: unknown): string | undefined {
  const root = typeof mediaV2 === "string" ? parseJson(mediaV2) : record(mediaV2);
  return selectPlayableVideoUrl(root.stream);
}

function normalizeUser(raw: unknown): DouyinUser | undefined {
  const user = record(raw);
  const uid = text(user.id) || text(user.user_id);
  if (!uid) return undefined;
  const redId = text(user.red_id);
  return {
    uid,
    secUid: uid,
    sec_uid: uid,
    douyinId: redId,
    nickname: text(user.name) || text(user.nickname),
    signature: text(user.desc) || text(user.sub_title),
    avatarUrl: text(user.image) || undefined,
    followerCount: number(user.fans),
    totalFavorited: 0,
    videoCount: number(user.note_count),
    profileUrl: `https://www.xiaohongshu.com/user/profile/${encodeURIComponent(uid)}`,
    xsecToken: text(user.xsec_token) || undefined,
  };
}

export interface ParsedXiaohongshuUsersPage {
  items: DouyinUser[];
  hasMore?: boolean;
}

export function parseXiaohongshuUsersPage(body: string): ParsedXiaohongshuUsersPage {
  const root = parseJson(body);
  const users = new Map<string, DouyinUser>();
  for (const raw of array(record(root.data).users)) {
    const user = normalizeUser(raw);
    if (user) users.set(user.uid, user);
  }
  return { items: [...users.values()], hasMore: hasMore(record(root.data).has_more) };
}

export interface XiaohongshuProfile {
  platform: "xiaohongshu";
  userId: string;
  redId: string;
  nickname: string;
  signature: string;
  avatarUrl?: string;
  gender: number;
}

export function parseXiaohongshuProfile(body: string): XiaohongshuProfile | undefined {
  const data = record(parseJson(body).data);
  const userId = text(data.user_id);
  if (!userId) return undefined;
  return {
    platform: "xiaohongshu",
    userId,
    redId: text(data.red_id),
    nickname: text(data.nickname),
    signature: text(data.desc),
    avatarUrl: text(data.images) || undefined,
    gender: number(data.gender),
  };
}

export function profileAsAccount(profile: XiaohongshuProfile): DouyinAccount {
  return {
    uid: profile.userId,
    secUid: profile.userId,
    douyinId: profile.redId,
    uniqueId: profile.redId,
    nickname: profile.nickname,
    signature: profile.signature,
    city: "",
    bindPhone: "",
    gender: profile.gender,
    avatarUrl: profile.avatarUrl,
    followerCount: 0,
    followingCount: 0,
    videoCount: 0,
  };
}

export function defaultXiaohongshuFilters(): VideoFilters {
  return {
    sort: "general",
    publishTime: "all",
    duration: "all",
    searchScope: "all",
    contentType: "all",
    location: "all",
  };
}
