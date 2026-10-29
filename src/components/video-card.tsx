import { Bookmark, Heart, MessageCircle, Play } from "lucide-react";
import type { DouyinVideo } from "../server/types";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";

function formatCount(value: number): string {
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)}万`;
  return String(value);
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatPublishedAt(value: string): string {
  if (!value) return "时间未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : date.toLocaleDateString();
}

export interface VideoCardProps {
  video: DouyinVideo;
  selected?: boolean;
  canPlay?: boolean;
  onToggle?: (video: DouyinVideo) => void;
  onPlay?: (video: DouyinVideo) => void;
}

/** Shared video card used by video search and the user detail page. */
export function VideoCard({ video, selected = false, canPlay = false, onToggle, onPlay }: VideoCardProps) {
  return <article className={`video-card${selected ? " selected" : ""}`}>
    <div className={`cover${canPlay ? " video-cover-clickable" : ""}`} onClick={(event) => {
      if (!canPlay || (event.target as HTMLElement).closest(".video-select-checkbox")) return;
      onPlay?.(video);
    }}>
      {video.coverUrl ? <img src={video.coverUrl} alt="" referrerPolicy={video.platform === "xiaohongshu" ? "no-referrer" : undefined} /> : <span>DY</span>}
      {onToggle && <Checkbox className="video-select-checkbox" checked={selected} onChange={() => onToggle(video)} aria-label={`${selected ? "取消选择" : "选择"}${video.title || "视频"}`} />}
      <span className="video-type-badge">{video.awemeType === 68 || video.type === "image-text" ? "图文" : "视频"}</span>
      {!(video.platform === "xiaohongshu" ? video.type === "video" && video.xsecToken : video.playUrl) && <span className="video-no-play-url">无播放地址</span>}
      {canPlay && <span className="video-cover-playback-mask" aria-hidden="true"><Play size={48} fill="currentColor" strokeWidth={0} /></span>}
      <b>{formatDuration(video.durationMs)}</b>
    </div>
    <div className="card-body">
      <h3 title={video.title}>{video.title || "无标题视频"}</h3>
      <p>@{video.author || "未知作者"} · {formatPublishedAt(video.publishedAt)}</p>
      <div className="metrics">
        <span><Heart size={14} />{formatCount(video.likes)}</span>
        <span><MessageCircle size={14} />{formatCount(video.comments)}</span>
        <span><Bookmark size={14} />{formatCount(video.favorites)}</span>
      </div>
      {onToggle && <div className="video-card-actions"><Button className="link-button" variant="secondary" aria-pressed={selected} onClick={() => onToggle(video)}>{selected ? "取消选择" : "选择视频"}</Button></div>}
    </div>
  </article>;
}
