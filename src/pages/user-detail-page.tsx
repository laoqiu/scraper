import { useVideoExport } from "./use-video-export";
import { VideoExportDialog } from "./video-export-dialog";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CreatorProfileSummary } from "../components/creator-profile-summary";
import { SelectionActions, VideoMetricFilters, type VideoMetricThresholds } from "../components/collection-controls";
import { FloatingVideoPlayer, type VideoPlaybackRequest } from "../components/floating-video-player";
import { VideoCard } from "../components/video-card";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../components/ui/empty";
import type { DouyinUser, DouyinVideo, PlatformId, UserDetailCollectionResult } from "../server/types";
import { EmptyState, errorText, formatCount, normalizeMaxPages, PageHeader, readPersistedState, structured, VideoSkeletonGrid, type ToolInput } from "./shared";

export interface UserDetailPageProps {
  app: App;
  initialInput: ToolInput;
  initialResult: CallToolResult | null;
  user?: DouyinUser;
  isToolEntry?: boolean;
  platform?: PlatformId;
}

export function UserInfo({ user, platform = "douyin", profileStats }: {
  user?: DouyinUser;
  platform?: PlatformId;
  profileStats?: UserDetailCollectionResult["profileStats"];
}) {
  return <Card className="user-detail-profile">
    <CreatorProfileSummary
      avatarUrl={user?.avatarUrl}
      nickname={user?.nickname}
      nameFallback="正在获取"
      loadingDetail={`等待${platform === "xiaohongshu" ? "小红书" : "抖音"}用户资料接口返回…`}
      authenticated={Boolean(user || profileStats)}
      meta={platform === "xiaohongshu" && (user || profileStats) ? <div className="creator-profile-meta">
        <span>关注 {profileStats?.followingCount === undefined ? "-" : formatCount(profileStats.followingCount)}</span>
        <span>| 粉丝 {profileStats?.followerCount === undefined ? (user ? formatCount(user.followerCount) : "-") : formatCount(profileStats.followerCount)}</span>
        <span>| 获赞与收藏 {profileStats?.likesAndCollectsCount === undefined ? "-" : formatCount(profileStats.likesAndCollectsCount)}</span>
        {user && <span>| 笔记 {formatCount(user.videoCount)}</span>}
      </div> : user ? <div className="creator-profile-meta"><span>抖音号 {user.douyinId || "-"}</span><span>| 粉丝 {formatCount(user.followerCount)}</span><span>| 获赞 {formatCount(user.totalFavorited)}</span></div> : undefined}
    />
  </Card>;
}

export function UserWorksList({
  videos,
  selectedIds,
  onToggle,
  onPlay,
  allowPlayback = true,
}: {
  videos: DouyinVideo[];
  selectedIds: Set<string>;
  onToggle: (video: DouyinVideo) => void;
  onPlay: (video: DouyinVideo) => void;
  allowPlayback?: boolean;
}) {
  return <section className="user-detail-videos">
    {videos.length ? <div className="card-grid">{videos.map((video) => <VideoCard
      key={video.id}
      video={video}
      selected={selectedIds.has(video.id)}
      canPlay={allowPlayback && (video.platform === "xiaohongshu" ? video.type === "video" && Boolean(video.xsecToken) : Boolean(video.playUrl))}
      onToggle={onToggle}
      onPlay={onPlay}
    />)}</div> : <Empty><EmptyMedia variant="icon">⌁</EmptyMedia><EmptyHeader><EmptyTitle>暂无用户作品</EmptyTitle><EmptyDescription>用户作品列表将在采集完成后显示。</EmptyDescription></EmptyHeader></Empty>}
  </section>;
}

function filterVideos(videos: DouyinVideo[], thresholds: VideoMetricThresholds): DouyinVideo[] {
  const minimum = (value: string): number | undefined => {
    if (!value.trim()) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const favorites = minimum(thresholds.favorites);
  const likes = minimum(thresholds.likes);
  const comments = minimum(thresholds.comments);
  return videos.filter((video) =>
    (favorites === undefined || video.favorites > favorites)
    && (likes === undefined || video.likes > likes)
    && (comments === undefined || video.comments > comments),
  );
}

export function UserDetailPage({ app, initialInput, initialResult, user, isToolEntry = false, platform = "douyin" }: UserDetailPageProps) {
  const initialDetail = structured<UserDetailCollectionResult>(initialResult);
  const initialJobId = typeof initialInput.jobId === "string" ? initialInput.jobId : initialDetail?.jobId;
  const [jobId, setJobId] = useState<string | undefined>(initialJobId);
  const secUid = String(initialInput.secUid ?? initialDetail?.secUid ?? user?.secUid ?? user?.sec_uid ?? "");
  const [detail, setDetail] = useState<UserDetailCollectionResult | undefined>(initialDetail?.kind === "user-detail" && initialDetail.secUid === secUid ? initialDetail : undefined);
  const [loading, setLoading] = useState(Boolean(secUid) && !initialDetail);
  const [error, setError] = useState<string | undefined>(initialResult ? errorText(initialResult) : undefined);
  const [thresholds, setThresholds] = useState<VideoMetricThresholds>({ favorites: "", likes: "", comments: "" });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [player, setPlayer] = useState<VideoPlaybackRequest>();
  const [collecting, setCollecting] = useState(false);
  const [serverCollecting, setServerCollecting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadedPages, setLoadedPages] = useState(initialDetail?.pages ?? 0);
  const [targetPages, setTargetPages] = useState(normalizeMaxPages(initialInput.maxPages));
  const lastLoadMoreAt = useRef(0);
  const automaticCollectionStarted = useRef(false);
  const localCollectionPending = useRef(false);
  const videoExport = useVideoExport(app, initialResult, typeof initialInput.exportId === "string" ? initialInput.exportId : undefined);
  const { exporting } = videoExport;

  useEffect(() => {
    const next = structured<UserDetailCollectionResult>(initialResult);
    if (typeof initialInput.jobId === "string") setJobId(initialInput.jobId);
    else if (next?.jobId) setJobId(next.jobId);
    if (next?.kind === "user-detail" && next.secUid === secUid) {
      setDetail(next);
      setLoading(false);
      setLoadedPages(next.pages ?? 1);
      setCollecting(false);
      setError(undefined);
    } else if (initialResult?.isError) {
      setLoading(false);
      setCollecting(false);
      setError(errorText(initialResult) || "用户详情采集失败");
    }
  }, [initialResult, secUid]);

  useEffect(() => {
    if (!secUid) return;
    let active = true;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const state = await readPersistedState(app, secUid, jobId);
        if (!active) return;
        const progress = state?.userDetailProgress;
        const next = state?.lastUserDetail;
        if (localCollectionPending.current && (progress?.secUid !== secUid || progress.status !== "collecting")) {
          timer = window.setTimeout(() => void refresh(), 250);
          return;
        }
        if (initialResult?.isError) {
          setLoading(false);
          setCollecting(false);
          setError(errorText(initialResult) || "用户详情采集失败");
          return;
        }
        if (next?.kind === "user-detail" && next.secUid === secUid) {
          setDetail(next);
        }
        if (progress?.secUid !== secUid) return;
        if (progress.status === "collecting") {
          setServerCollecting(true);
          setLoading(true);
          timer = window.setTimeout(() => void refresh(), 250);
        } else {
          setServerCollecting(false);
          if (progress.status === "error" && localCollectionPending.current) {
            timer = window.setTimeout(() => void refresh(), 700);
            return;
          }
          setLoading(false);
          if (progress.status === "error") setError(progress.message || "用户详情采集失败");
        }
      } catch {
        if (active) timer = window.setTimeout(() => void refresh(), 1_200);
      }
    };
    void refresh();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [app, secUid, jobId, initialResult]);

  useEffect(() => {
    if (!secUid || isToolEntry || (initialDetail?.kind === "user-detail" && initialDetail.secUid === secUid) || automaticCollectionStarted.current) return;
    automaticCollectionStarted.current = true;
    localCollectionPending.current = true;
    let active = true;
    const collect = async () => {
      try {
        setDetail(undefined);
        setError(undefined);
        setLoading(true);
        const requestedPages = normalizeMaxPages(initialInput.maxPages);
        setTargetPages(requestedPages);
        lastLoadMoreAt.current = 0;
        const response = await app.callServerTool({
          name: platform === "xiaohongshu" ? "xiaohongshu.collect_user_notes" : "douyin.collect_user_videos",
          arguments: { secUid, ...(platform === "xiaohongshu" && typeof initialInput.xsecToken === "string" ? { xsecToken: initialInput.xsecToken } : {}), maxPages: platform === "xiaohongshu" ? requestedPages : 1 },
        });
        localCollectionPending.current = false;
        if (!active) return;
        const message = errorText(response);
        if (message) {
          setError(message);
          setLoading(false);
          return;
        }
        const nextJobId = (structured<{ jobId?: unknown }>(response)?.jobId as string | undefined) ?? jobId;
        if (nextJobId) setJobId(nextJobId);
        const state = await readPersistedState(app, secUid, nextJobId);
        const next = state?.lastUserDetail;
        if (next?.kind === "user-detail" && next.secUid === secUid) {
          setDetail(next);
          const actualPages = next.pages ?? 1;
          setLoadedPages(actualPages);
          setCollecting(next.hasMore !== false && actualPages < requestedPages);
        }
        setLoading(false);
      } catch (cause) {
        localCollectionPending.current = false;
        if (!active) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      }
    };
    if (!isToolEntry) void collect();
    return () => {
      active = false;
    };
  }, [app, initialInput.maxPages, initialDetail, initialInput.xsecToken, isToolEntry, platform, secUid]);

  const loadMore = async () => {
    if (loadingMore || !detail || detail.hasMore === false || loadedPages >= targetPages) return;
    const now = Date.now();
    if (now - lastLoadMoreAt.current < 2_500) return;
    lastLoadMoreAt.current = now;
    const nextPage = loadedPages + 1;
    setLoadingMore(true);
    setLoading(true);
    setError(undefined);
    try {
      const response = await app.callServerTool({
        name: platform === "xiaohongshu" ? "xiaohongshu.collect_user_notes" : "douyin.collect_user_videos",
        arguments: { secUid, ...(platform === "xiaohongshu" && typeof initialInput.xsecToken === "string" ? { xsecToken: initialInput.xsecToken } : {}), maxPages: nextPage },
      });
      const message = errorText(response);
      setError(message);
      const nextJobId = (structured<{ jobId?: unknown }>(response)?.jobId as string | undefined) ?? jobId;
      if (nextJobId) setJobId(nextJobId);
      const state = !message ? await readPersistedState(app, secUid, nextJobId) : undefined;
      const next = state?.lastUserDetail;
      if (!message && next?.kind === "user-detail" && next.secUid === secUid) {
        setDetail(next);
        const actualPages = next.pages ?? nextPage;
        setLoadedPages(actualPages);
        const finished = next.hasMore === false || actualPages >= targetPages;
        setCollecting(!finished);
      } else {
        setCollecting(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setCollecting(false);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!detail || loading || !collecting || loadingMore || detail.hasMore === false || loadedPages >= targetPages) return;
    void loadMore();
  }, [detail, loading, collecting, loadingMore, loadedPages, targetPages]);

  const videos = useMemo(() => filterVideos(detail?.items ?? [], thresholds), [detail, thresholds]);
  useEffect(() => {
    const available = new Set(detail?.items.map((video) => video.id) ?? []);
    setSelectedIds((current) => new Set([...current].filter((id) => available.has(id))));
  }, [detail]);

  const selectAll = () => setSelectedIds((current) => new Set([...current, ...videos.map((video) => video.id)]));
  const invertSelection = () => setSelectedIds((current) => {
    const next = new Set(current);
    for (const video of videos) {
      if (next.has(video.id)) next.delete(video.id);
      else next.add(video.id);
    }
    return next;
  });
  const toggleVideo = (video: DouyinVideo) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(video.id)) next.delete(video.id);
    else next.add(video.id);
    return next;
  });
  const deleteSelected = () => {
    setDetail((current) => current ? { ...current, items: current.items.filter((video) => !selectedIds.has(video.id)) } : current);
    setSelectedIds(new Set());
  };

  const playVideo = (video: DouyinVideo) => {
    if (video.platform === "xiaohongshu") {
      if (serverCollecting || loadingMore || (detail?.hasMore !== false && (detail?.pages ?? 0) < targetPages) || video.type !== "video" || !video.xsecToken) return;
      setPlayer({ videoId: video.id, platform: video.platform, xsecToken: video.xsecToken });
      return;
    }
    if (!video.playUrl) return;
    setPlayer({ videoId: video.id, platform: video.platform, playUrl: video.playUrl });
  };

  const selectedVideos = () => detail?.items.filter((video) => selectedIds.has(video.id)) ?? [];

  const exportSelected = () => videoExport.start(selectedVideos());

  const xiaohongshuPlaybackReady = !serverCollecting
    && !loadingMore
    && Boolean(detail)
    && (detail?.hasMore === false || (detail?.pages ?? 0) >= targetPages);

  return <main className="page user-detail-page">
    <PageHeader eyebrow="CREATOR PROFILE" title="用户详情" description="展示用户信息和作品列表" />
    {error && <div className="error-banner">{error}</div>}
    {secUid ? <>
      <UserInfo user={detail?.user ?? user} platform={platform} profileStats={detail?.profileStats} />
      <section className="video-actions user-detail-actions">
        <VideoMetricFilters value={thresholds} onChange={setThresholds} />
        <SelectionActions
          visibleCount={videos.length}
          selectedCount={selectedIds.size}
          onSelectAll={selectAll}
          onInvert={invertSelection}
          onDelete={() => setDeleteOpen(true)}
        >
          <Button variant="secondary" onClick={() => void exportSelected()} disabled={!selectedIds.size && !exporting}>{exporting ? "查看保存进度" : "保存数据"}</Button>
          {videoExport.job && !exporting && !videoExport.open && <Button variant="secondary" onClick={() => videoExport.setOpen(true)}>查看上次保存结果</Button>}
        </SelectionActions>
      </section>
      <div className="user-detail-results" onScroll={(event) => {
        const element = event.currentTarget;
        if (element.scrollTop + element.clientHeight >= element.scrollHeight - 80) void loadMore();
      }}>
        {loading && !detail && <VideoSkeletonGrid />}
        {detail && <UserWorksList videos={videos} selectedIds={selectedIds} onToggle={toggleVideo} onPlay={playVideo} allowPlayback={platform !== "xiaohongshu" || xiaohongshuPlaybackReady} />}
        {!loading && !detail && <EmptyState title="没有用户详情" detail="未收到抖音用户信息或作品数据。" />}
        {loadingMore && <div className="load-more-state">正在加载更多作品…</div>}
        {detail && detail.hasMore === false && <div className="load-more-state">没有更多作品了</div>}
      </div>
    </> : <EmptyState title="未选择用户" detail="请返回用户列表，点击“采集用户视频”。" />}
    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <DialogContent className="video-delete-dialog">
        <DialogHeader>
          <DialogTitle>确认删除作品</DialogTitle>
          <DialogDescription>确定要从当前用户作品列表中删除已选的 {selectedIds.size} 个作品吗？此操作不会删除抖音原作品。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setDeleteOpen(false)}>取消</Button>
          <Button className="primary" onClick={() => { deleteSelected(); setDeleteOpen(false); }}>确认删除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <VideoExportDialog app={app} state={videoExport} />
    {player && <FloatingVideoPlayer app={app} request={player} onClose={() => setPlayer(undefined)} />}
  </main>;
}
