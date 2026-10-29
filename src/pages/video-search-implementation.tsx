import { VideoExportDialog } from "./video-export-dialog";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { Play } from "lucide-react";
import { SelectionActions, VideoMetricFilters } from "../components/collection-controls";
import { FloatingVideoPlayer } from "../components/floating-video-player";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Spinner } from "../components/ui/spinner";
import type { PlatformId, VideoFilters } from "../server/types";
import { VideoCard } from "../components/video-card";
import { EmptyState, PageHeader, VideoSkeletonGrid, type ToolInput } from "./shared";
import { useVideoCollection } from "./use-video-collection";
import "../styles.css";

export function VideosPage({ app, initialInput, initialResult, platform = "douyin" }: { app: App; initialInput: ToolInput; initialResult: CallToolResult | null; platform?: PlatformId }) {
  const state = useVideoCollection({ app, initialInput, initialResult, platform });
  const {
    result, query, setQuery, filters, setFilters, busy, collecting, loadingMore, error, selectedIds, thresholds, setThresholds,
    player, setPlayer, exporting, videoExport, deleteOpen, setDeleteOpen, filteredVideos, loadedPages, targetPages,
    run, stopCollection, loadMore, toggleVideo, selectAll, invertSelection, deleteSelected, exportSelected,
  } = state;
  const isXiaohongshu = platform === "xiaohongshu";
  const sortOptions = isXiaohongshu
    ? [{ value: "general", label: "选择排序" }, { value: "latest", label: "最新" }, { value: "most-liked", label: "最多点赞" }, { value: "most-commented", label: "最多评论" }, { value: "most-collected", label: "最多收藏" }]
    : [{ value: "general", label: "选择排序" }, { value: "latest", label: "最新发布" }, { value: "most-liked", label: "最多点赞" }];

  return <main className="page videos-page">
    <PageHeader eyebrow={isXiaohongshu ? "XIAOHONGSHU COLLECTION" : "VIDEO COLLECTION"} title={isXiaohongshu ? "笔记采集" : "视频采集"} description="采集关键词搜索结果，按设定页数自动加载。" />
    <Card className="video-controls">
      <div className="video-toolbar">
        <Input className="video-query-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入搜索关键词" onKeyDown={(event) => event.key === "Enter" && void run()} />
        <Button className="primary video-submit" disabled={!query.trim()} onClick={() => collecting ? stopCollection() : void run()}>{collecting ? <><Spinner />停止采集</> : busy ? <><Spinner />采集中…</> : <><Play size={14} fill="currentColor" strokeWidth={0} />开始采集</>}</Button>
      </div>
      <div className="video-filters">
        <Select value={filters.sort} placeholder="选择排序" options={sortOptions} onValueChange={(value) => setFilters({ ...filters, sort: value as VideoFilters["sort"] })} />
        <Select value={filters.publishTime} placeholder="选择发布时间" options={[{ value: "all", label: "选择发布时间" }, { value: "day", label: "一天内" }, { value: "week", label: "一周内" }, { value: "half-year", label: "半年内" }]} onValueChange={(value) => setFilters({ ...filters, publishTime: value as VideoFilters["publishTime"] })} />
        {isXiaohongshu
          ? <Select value={filters.contentType ?? "all"} placeholder="选择笔记类型" options={[{ value: "all", label: "选择笔记类型" }, { value: "video", label: "视频" }, { value: "image-text", label: "图文" }]} onValueChange={(value) => setFilters({ ...filters, contentType: value as VideoFilters["contentType"] })} />
          : <Select value={filters.duration} placeholder="选择视频时长" options={[{ value: "all", label: "选择视频时长" }, { value: "short", label: "1分钟以下" }, { value: "medium", label: "1-5分钟" }, { value: "long", label: "5分钟以上" }]} onValueChange={(value) => setFilters({ ...filters, duration: value as VideoFilters["duration"] })} />}
        <Select value={filters.searchScope ?? "all"} placeholder="选择搜索范围" options={isXiaohongshu ? [{ value: "all", label: "选择搜索范围" }, { value: "following", label: "已关注" }, { value: "watched", label: "已看过" }, { value: "unwatched", label: "未看过" }] : [{ value: "all", label: "选择搜索范围" }, { value: "following", label: "关注的人" }, { value: "watched", label: "最近看过" }, { value: "unwatched", label: "还未看过" }]} onValueChange={(value) => setFilters({ ...filters, searchScope: value as VideoFilters["searchScope"] })} />
        {isXiaohongshu
          ? <Select value={filters.location ?? "all"} placeholder="选择位置距离" options={[{ value: "all", label: "选择位置距离" }, { value: "city", label: "同城" }, { value: "nearby", label: "附近" }]} onValueChange={(value) => setFilters({ ...filters, location: value as VideoFilters["location"] })} />
          : <Select value={filters.contentType ?? "all"} placeholder="选择内容形式" options={[{ value: "all", label: "选择内容形式" }, { value: "video", label: "视频" }, { value: "image-text", label: "图文" }]} onValueChange={(value) => setFilters({ ...filters, contentType: value as VideoFilters["contentType"] })} />}
      </div>
    </Card>
    <div className="video-actions">
      <VideoMetricFilters value={thresholds} onChange={setThresholds} />
      <SelectionActions visibleCount={filteredVideos.length} selectedCount={selectedIds.size} onSelectAll={selectAll} onInvert={invertSelection} onDelete={() => setDeleteOpen(true)}>
        <Button variant="secondary" onClick={() => void exportSelected()} disabled={!selectedIds.size && !exporting}>{exporting ? "查看保存进度" : "保存数据"}</Button>
        {videoExport.job && !exporting && !videoExport.open && <Button variant="secondary" onClick={() => videoExport.setOpen(true)}>查看上次保存结果</Button>}
      </SelectionActions>
    </div>
    <div className="video-results" onScroll={(event) => {
      const element = event.currentTarget;
      if (element.scrollTop + element.clientHeight >= element.scrollHeight - 80) void loadMore(true);
    }}>
      {error && <div className="error-banner">{error}</div>}
      {!result && !busy && <EmptyState title="等待采集" detail="设置关键词后开始采集，结果会显示在这里。" />}
      {busy && <VideoSkeletonGrid />}
      {result && !busy && <div className="card-grid">{filteredVideos.map((video) => {
        const playable = video.platform === "xiaohongshu" ? video.type === "video" && Boolean(video.xsecToken) : Boolean(video.playUrl);
        return <VideoCard key={video.id} video={video} selected={selectedIds.has(video.id)} canPlay={playable && !collecting && !busy && (result.hasMore === false || loadedPages >= targetPages)} onToggle={(item) => toggleVideo(item.id)} onPlay={(item) => setPlayer({ videoId: item.id, platform: item.platform, playUrl: item.playUrl, xsecToken: item.xsecToken })} />;
      })}</div>}
      {loadingMore && <div className="load-more-state">正在加载更多视频…</div>}
      {result && result.hasMore === false && <div className="load-more-state">没有更多视频了</div>}
    </div>
    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <DialogContent className="video-delete-dialog">
        <DialogHeader><DialogTitle>确认删除视频</DialogTitle><DialogDescription>确定要从当前视频列表中删除已选的 {selectedIds.size} 个视频吗？此操作不会删除抖音原视频。</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="secondary" onClick={() => setDeleteOpen(false)}>取消</Button><Button className="primary" onClick={() => { deleteSelected(); setDeleteOpen(false); }}>确认删除</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    {player && <FloatingVideoPlayer app={app} request={player} onClose={() => setPlayer(undefined)} />}
    <VideoExportDialog app={app} state={videoExport} />
  </main>;
}
