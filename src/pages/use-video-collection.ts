import { useVideoExport } from "./use-video-export";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PlatformId, VideoCollectionResult, VideoFilters } from "../server/types";
import { errorText, normalizeMaxPages, readPersistedState, structured, type ToolInput } from "./shared";
import type { VideoPlaybackRequest } from "../components/floating-video-player";

const defaultFilters: VideoFilters = { sort: "general", publishTime: "all", duration: "all", searchScope: "all", contentType: "all" };

function inputFilters(value: unknown): Partial<VideoFilters> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Partial<VideoFilters>;
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Partial<VideoFilters> : undefined;
  } catch {
    return undefined;
  }
}

export function useVideoCollection({
  app,
  initialInput,
  initialResult,
  platform = "douyin",
}: {
  app: App;
  initialInput: ToolInput;
  initialResult: CallToolResult | null;
  platform?: PlatformId;
}) {
  const first = structured<VideoCollectionResult>(initialResult);
  const initialJobId = typeof initialInput.jobId === "string" ? initialInput.jobId : first?.jobId;
  const [result, setResult] = useState<VideoCollectionResult | undefined>(first?.kind === "videos" ? first : undefined);
  const [jobId, setJobId] = useState<string | undefined>(initialJobId);
  const [query, setQuery] = useState(String(initialInput.keyword ?? ""));
  const [filters, setFilters] = useState<VideoFilters>({ ...defaultFilters, ...inputFilters(initialInput.filters) });
  const [busy, setBusy] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [serverCollecting, setServerCollecting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadedPages, setLoadedPages] = useState(normalizeMaxPages(initialInput.maxPages));
  const [targetPages, setTargetPages] = useState(normalizeMaxPages(initialInput.maxPages));
  const [error, setError] = useState<string | undefined>(initialResult ? errorText(initialResult) : undefined);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [thresholds, setThresholds] = useState({ favorites: "", likes: "", comments: "" });
  const [player, setPlayer] = useState<VideoPlaybackRequest>();
  const videoExport = useVideoExport(app, initialResult, typeof initialInput.exportId === "string" ? initialInput.exportId : undefined);
  const { exporting } = videoExport;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const lastLoadMoreAt = useRef(0);
  const loadingMoreRef = useRef(false);
  const stopRequested = useRef(false);
  const manualRun = useRef(false);
  const targetPagesRef = useRef(normalizeMaxPages(initialInput.maxPages));
  const previousToolInput = useRef(JSON.stringify({ keyword: initialInput.keyword ?? null, filters: initialInput.filters ?? null, maxPages: initialInput.maxPages ?? null }));
  const previousInitialResult = useRef(initialResult);
  const searchToolName = platform === "xiaohongshu" ? "xiaohongshu.search_videos" : "douyin.search_videos";

  const updateTargetPages = (pages: number) => {
    targetPagesRef.current = pages;
    setTargetPages(pages);
  };

  useEffect(() => {
    const next = structured<VideoCollectionResult>(initialResult);
    if (next?.kind === "videos") setResult(next);
    const message = initialResult ? errorText(initialResult) : undefined;
    if (message) {
      stopRequested.current = true;
      setError(message);
      setBusy(false);
      setCollecting(false);
      setServerCollecting(false);
      setLoadingMore(false);
    }
  }, [initialResult]);

  useEffect(() => {
    const incomingResult = structured<VideoCollectionResult>(initialResult);
    if (typeof initialInput.jobId === "string") setJobId(initialInput.jobId);
    else if (incomingResult?.jobId) setJobId(incomingResult.jobId);
    const incomingKeyword = typeof initialInput.keyword === "string" ? initialInput.keyword : incomingResult?.kind === "videos" ? incomingResult.keyword : undefined;
    const incomingFilters = inputFilters(initialInput.filters) ?? (incomingResult?.kind === "videos" ? incomingResult.filters : undefined);
    if (incomingKeyword !== undefined) setQuery(incomingKeyword);
    if (incomingFilters) setFilters({ ...defaultFilters, ...incomingFilters });
    const inputKey = JSON.stringify({ keyword: initialInput.keyword ?? null, filters: initialInput.filters ?? null, maxPages: initialInput.maxPages ?? null });
    if (previousToolInput.current !== inputKey || (initialResult === null && previousInitialResult.current !== null)) {
      manualRun.current = false;
      stopRequested.current = false;
      previousToolInput.current = inputKey;
    }
    previousInitialResult.current = initialResult;
    if (initialInput.maxPages !== undefined) updateTargetPages(normalizeMaxPages(initialInput.maxPages));
  }, [initialInput, initialResult]);

  useEffect(() => {
    setSelectedIds((current) => new Set([...current].filter((id) => result?.items.some((item) => item.id === id))));
  }, [result]);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const state = await readPersistedState(app, undefined, jobId);
        if (!active) return;
        const restoreSearchInput = initialInput.keyword === undefined && initialInput.filters === undefined;
        if (restoreSearchInput && !manualRun.current) {
          const persistedInput = state?.lastVideoSearch;
          const persistedResult = state?.lastVideos;
          if (persistedInput) {
            setQuery(persistedInput.keyword);
            setFilters({ ...defaultFilters, ...persistedInput.filters });
            updateTargetPages(normalizeMaxPages(persistedInput.maxPages));
          } else if (persistedResult) {
            setQuery(persistedResult.keyword);
            setFilters({ ...defaultFilters, ...persistedResult.filters });
          }
        }
        const progress = state?.videoProgress;
        if (!progress) return;
        if (initialResult?.isError) {
          setServerCollecting(false);
          setCollecting(false);
          setBusy(false);
          setLoadingMore(false);
          return;
        }
        if (progress.status === "collecting") {
          setServerCollecting(true);
          if (!stopRequested.current) setCollecting(true);
          if (!manualRun.current) updateTargetPages(progress.maxPages);
          if (progress.pages === 0) {
            setResult(undefined);
            setBusy(true);
          } else if (state.lastVideos) {
            setResult(state.lastVideos);
            setLoadedPages(Math.max(1, progress.pages));
            setBusy(false);
          } else {
            setBusy(true);
          }
          timer = window.setTimeout(() => void refresh(), 700);
          return;
        }
        setServerCollecting(false);
        if (state.lastVideos) {
          setResult(state.lastVideos);
          setLoadedPages(Math.max(1, progress.pages));
          setBusy(false);
        }
        if (progress.status === "error") setError(progress.message || "视频采集失败");
        else if (manualRun.current && !stopRequested.current && state.lastVideos) {
          const pages = state.lastVideos.pages ?? progress.pages;
          setCollecting(state.lastVideos.hasMore !== false && pages < targetPagesRef.current);
        } else {
          setCollecting(false);
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
  }, [app, initialResult, jobId]);

  const run = async () => {
    if (!query.trim()) return;
    manualRun.current = true;
    stopRequested.current = false;
    setBusy(true);
    setCollecting(true);
    setError(undefined);
    setSelectedIds(new Set());
    lastLoadMoreAt.current = 0;
    const requestedPages = normalizeMaxPages(initialInput.maxPages);
    updateTargetPages(requestedPages);
    try {
      const submittedFilters = platform === "xiaohongshu"
        ? { sort: filters.sort, publishTime: filters.publishTime, contentType: filters.contentType ?? "all", searchScope: filters.searchScope ?? "all", location: filters.location ?? "all" }
        : filters;
      const response = await app.callServerTool({ name: searchToolName, arguments: { keyword: query.trim(), filters: submittedFilters, maxPages: 1 } });
      const message = errorText(response);
      setError(message);
      if (message) {
        stopRequested.current = true;
        setCollecting(false);
        setServerCollecting(false);
        setLoadingMore(false);
        return;
      }
      const nextJobId = (structured<{ jobId?: unknown }>(response)?.jobId as string | undefined) ?? jobId;
      if (nextJobId) setJobId(nextJobId);
      const state = await readPersistedState(app, undefined, nextJobId);
      const next = state?.lastVideos;
      if (next) {
        setResult(next);
        const actualPages = next.pages ?? 1;
        setLoadedPages(actualPages);
        setBusy(false);
        const stillCollecting = !stopRequested.current && next.hasMore !== false && actualPages < requestedPages;
        setCollecting(stillCollecting);
        await app.updateModelContext({
          content: [{ type: "text", text: stillCollecting ? `已采集第 ${actualPages} 页，共 ${next.items.length} 条，正在继续采集至 ${requestedPages} 页。` : `本次采集结束，共 ${next.items.length} 条内容。` }],
          structuredContent: { kind: "videos", jobId: next.jobId, keyword: next.keyword, pages: actualPages, count: next.items.length },
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setCollecting(false);
    } finally {
      setBusy(false);
    }
  };

  const stopCollection = () => {
    stopRequested.current = true;
    setCollecting(false);
    setBusy(false);
    updateTargetPages(loadedPages);
  };

  const loadMore = async (manual = false) => {
    if (serverCollecting || stopRequested.current || loadingMore || loadingMoreRef.current || !result || result.hasMore === false || (!manual && loadedPages >= targetPages)) return;
    const now = Date.now();
    if (now - lastLoadMoreAt.current < 2500) return;
    lastLoadMoreAt.current = now;
    const nextPage = loadedPages + 1;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError(undefined);
    try {
      const submittedFilters = platform === "xiaohongshu"
        ? { sort: filters.sort, publishTime: filters.publishTime, contentType: filters.contentType ?? "all", searchScope: filters.searchScope ?? "all", location: filters.location ?? "all" }
        : filters;
      const response = await app.callServerTool({ name: searchToolName, arguments: { keyword: query.trim(), filters: submittedFilters, maxPages: nextPage } });
      const message = errorText(response);
      setError(message);
      const state = !message ? await readPersistedState(app, undefined, jobId) : undefined;
      const next = state?.lastVideos;
      if (!message && next) {
        setResult(next);
        const actualPages = next.pages ?? nextPage;
        setLoadedPages(actualPages);
        const finished = stopRequested.current || next.hasMore === false || actualPages >= targetPages;
        if (finished) {
          setCollecting(false);
          const videoCount = next.items.filter((item) => item.type === "video").length;
          await app.updateModelContext({ content: [{ type: "text", text: ["本次采集结束：", `共采集页数 ${actualPages} 页`, `共采集内容数量 ${next.items.length} 个，其中视频 ${videoCount} 个，图文 ${next.items.length - videoCount} 个`, "", "你可以继续以下操作：", next.hasMore === false ? "过滤指定内容（支持点赞、收藏、评论过滤）" : "继续翻页或过滤指定内容（支持点赞、收藏、评论过滤）"].join("\n") }], structuredContent: { kind: "videos", jobId: next.jobId, pages: actualPages, count: next.items.length } });
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setCollecting(false);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!result || busy || !collecting || serverCollecting || loadingMore || result.hasMore === false || loadedPages >= targetPages) return;
    const wait = Math.max(0, 2500 - (Date.now() - lastLoadMoreAt.current));
    const timer = window.setTimeout(() => void loadMore(), wait);
    return () => window.clearTimeout(timer);
  }, [result, busy, collecting, serverCollecting, loadingMore, loadedPages, targetPages]);

  const filteredVideos = useMemo(() => {
    if (!result) return [];
    const minimum = (value: string): number | undefined => {
      if (!value.trim()) return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const favorites = minimum(thresholds.favorites);
    const comments = minimum(thresholds.comments);
    const likes = minimum(thresholds.likes);
    return result.items.filter((video) => (favorites === undefined || video.favorites > favorites) && (comments === undefined || video.comments > comments) && (likes === undefined || video.likes > likes));
  }, [result, thresholds]);

  const toggleVideo = (id: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectAll = () => setSelectedIds((current) => {
    const next = new Set(current);
    for (const video of filteredVideos) next.add(video.id);
    return next;
  });
  const invertSelection = () => setSelectedIds((current) => {
    const next = new Set(current);
    for (const video of filteredVideos) {
      if (next.has(video.id)) next.delete(video.id); else next.add(video.id);
    }
    return next;
  });
  const deleteSelected = () => {
    if (!result || !selectedIds.size) return;
    setResult({ ...result, items: result.items.filter((video) => !selectedIds.has(video.id)) });
    setSelectedIds((current) => new Set([...current].filter((id) => !selectedIds.has(id))));
  };
  const exportSelected = () => videoExport.start(result?.items.filter((video) => selectedIds.has(video.id)) ?? []);

  return {
    result, query, setQuery, filters, setFilters, busy, collecting, loadingMore, error, selectedIds, thresholds, setThresholds,
    player, setPlayer, exporting, videoExport, deleteOpen, setDeleteOpen, filteredVideos, targetPages, loadedPages,
    run, stopCollection, loadMore, toggleVideo, selectAll, invertSelection, deleteSelected, exportSelected,
  };
}
