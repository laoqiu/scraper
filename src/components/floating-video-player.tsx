import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { Pause, Play, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { Spinner } from "./ui/spinner";
import type { PlatformId } from "../server/types";

const MAX_PLAYBACK_RETRIES = 2;
const PLAYBACK_RETRY_DELAY_MS = 350;

export interface VideoPlaybackRequest {
  videoId: string;
  playUrl?: string;
  platform?: PlatformId;
  xsecToken?: string;
}

interface PlaybackResult {
  kind?: string;
  videoId?: string;
  videoUrl?: string;
}

function toolError(result: CallToolResult): string | undefined {
  if (!result.isError) return undefined;
  const item = result.content?.find((entry) => entry.type === "text");
  return item?.type === "text" ? item.text : "视频播放失败";
}

/** Shared floating player used by video search and user detail pages. */
export function FloatingVideoPlayer({ app, request, onClose }: { app: App; request: VideoPlaybackRequest; onClose: () => void }) {
  const [videoUrl, setVideoUrl] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();
  const [paused, setPaused] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const playerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const position = useRef({ x: 0, y: 0 });
  const drag = useRef<{ startX: number; startY: number; startLeft: number; startTop: number; width: number; height: number } | undefined>(undefined);
  const loadGeneration = useRef(0);
  const retryCount = useRef(0);
  const retrying = useRef(false);

  const loadPlayback = useCallback(async (generation: number): Promise<boolean> => {
    try {
      const isXiaohongshu = request.platform === "xiaohongshu";
      console.info(`[scraper-ui] playback request platform=${request.platform ?? "douyin"} tool=${isXiaohongshu ? "xiaohongshu.play_video" : "douyin.play_video"} videoId=${request.videoId} hasPlayUrl=${Boolean(request.playUrl)} hasXsecToken=${Boolean(request.xsecToken)}`);
      const response = await app.callServerTool({
        name: isXiaohongshu ? "xiaohongshu.play_video" : "douyin.play_video",
        arguments: isXiaohongshu
          ? { videoId: request.videoId, xsecToken: request.xsecToken }
          : { videoId: request.videoId, playUrl: request.playUrl },
      });
      if (generation !== loadGeneration.current) return false;
      const message = toolError(response);
      if (message) throw new Error(message);
      const result = response.structuredContent as PlaybackResult | undefined;
      if (result?.kind !== "video-player" || !result.videoUrl) throw new Error("未获取到视频播放地址");
      console.info(`[scraper-ui] playback proxy platform=${request.platform ?? "douyin"} videoId=${request.videoId} url=${result.videoUrl}`);
      setVideoUrl(result.videoUrl);
      setError(undefined);
      setBusy(false);
      return true;
    } catch (cause) {
      console.error(`[scraper-ui] playback failed platform=${request.platform ?? "douyin"} videoId=${request.videoId}`, cause);
      if (generation === loadGeneration.current) {
        setVideoUrl(undefined);
        setError(cause instanceof Error ? cause.message : String(cause));
        setBusy(false);
      }
      return false;
    }
  }, [app, request]);

  useEffect(() => {
    const generation = ++loadGeneration.current;
    retryCount.current = 0;
    retrying.current = false;
    setVideoUrl(undefined);
    setBusy(true);
    setError(undefined);
    setPaused(false);
    void loadPlayback(generation);
    return () => {
      if (loadGeneration.current === generation) loadGeneration.current += 1;
    };
  }, [loadPlayback]);

  const startDrag = (event: ReactDragEvent<HTMLDivElement>) => {
    const element = playerRef.current;
    if (!element) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", "douyin-video-player");
    const dragImage = document.createElement("canvas");
    dragImage.width = 1;
    dragImage.height = 1;
    event.dataTransfer.setDragImage(dragImage, 0, 0);
    const rect = element.getBoundingClientRect();
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      width: rect.width,
      height: rect.height,
    };
  };

  const moveDrag = (event: ReactDragEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || (event.clientX === 0 && event.clientY === 0)) return;
    const baseLeft = window.innerWidth - 24 - current.width;
    const baseTop = window.innerHeight - 24 - current.height;
    const nextLeft = Math.min(window.innerWidth - current.width, Math.max(0, current.startLeft + event.clientX - current.startX));
    const nextTop = Math.min(window.innerHeight - current.height, Math.max(0, current.startTop + event.clientY - current.startY));
    position.current = { x: nextLeft - baseLeft, y: nextTop - baseTop };
    setOffset(position.current);
  };

  const stopDrag = () => {
    drag.current = undefined;
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };

  const retryPlayback = () => {
    if (retrying.current || busy) return;
    const nextAttempt = retryCount.current + 1;
    if (nextAttempt > MAX_PLAYBACK_RETRIES) {
      setVideoUrl(undefined);
      setError("视频播放失败，播放地址暂时不可用，请稍后重试");
      setBusy(false);
      return;
    }
    retryCount.current = nextAttempt;
    retrying.current = true;
    const generation = loadGeneration.current;
    setVideoUrl(undefined);
    setError(undefined);
    setBusy(true);
    window.setTimeout(() => {
      if (generation !== loadGeneration.current) {
        retrying.current = false;
        return;
      }
      void loadPlayback(generation).finally(() => {
        retrying.current = false;
      });
    }, PLAYBACK_RETRY_DELAY_MS);
  };

  return <div ref={playerRef} className="floating-video-player" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
    <div className="floating-video-player-bar" draggable onDragStart={startDrag} onDrag={moveDrag} onDragEnd={stopDrag}>
      视频播放
      <button type="button" draggable={false} className="floating-video-player-close" aria-label="关闭播放器" onDragStart={(event) => event.stopPropagation()} onClick={onClose}><X size={14} /></button>
    </div>
    <div className="floating-video-player-stage">
      {videoUrl && <video ref={videoRef} key={videoUrl} src={videoUrl} controls autoPlay playsInline preload="auto" onPlay={() => { setPaused(false); setBusy(false); }} onPause={() => setPaused(true)} onError={retryPlayback} />}
      {videoUrl && !busy && !error && <button type="button" className="floating-video-player-toggle" aria-label={paused ? "播放视频" : "暂停视频"} onClick={togglePlayback}>{paused ? <Play size={48} fill="currentColor" strokeWidth={0} /> : <Pause size={48} fill="currentColor" strokeWidth={0} />}</button>}
      {!videoUrl && !busy && !error && <div className="floating-video-player-placeholder" />}
      {busy && <div className="floating-video-player-loading"><Spinner />正在加载视频…</div>}
      {error && <div className="floating-video-player-error">{error}</div>}
    </div>
  </div>;
}
