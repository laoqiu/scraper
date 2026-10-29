import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DouyinUser, PlatformId, UserCollectionResult, UserFilters } from "../server/types";
import { defaultUserFilters, errorText, normalizeMaxPages, readPersistedState, structured, type ToolInput } from "./shared";

export function userId(user: DouyinUser): string {
  return user.sec_uid || user.secUid || user.uid;
}

export function useUserSearch({ app, initialInput, initialResult, onOpenUserDetail, platform = "douyin" }: {
  app: App;
  initialInput: ToolInput;
  initialResult: CallToolResult | null;
  onOpenUserDetail?: (user: DouyinUser) => void;
  platform?: PlatformId;
}) {
  const first = structured<UserCollectionResult>(initialResult);
  const initialJobId = typeof initialInput.jobId === "string" ? initialInput.jobId : first?.jobId;
  const [keyword, setKeyword] = useState(String(initialInput.keyword ?? first?.keyword ?? ""));
  const [jobId, setJobId] = useState<string | undefined>(initialJobId);
  const [filters, setFilters] = useState<UserFilters>({ ...defaultUserFilters, ...(initialInput.filters as Partial<UserFilters> | undefined), ...(first?.filters ?? {}) });
  const [result, setResult] = useState<UserCollectionResult | undefined>(first?.kind === "users" ? first : undefined);
  const [busy, setBusy] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [serverCollecting, setServerCollecting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadedPages, setLoadedPages] = useState(first?.pages ?? 0);
  const [targetPages, setTargetPages] = useState(normalizeMaxPages(initialInput.maxPages));
  const [currentAccountUid, setCurrentAccountUid] = useState("");
  const [error, setError] = useState<string | undefined>(initialResult ? errorText(initialResult) : undefined);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [thresholds, setThresholds] = useState({ followers: "", likes: "" });
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ count: number; filePath: string }>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const searchToolName = platform === "xiaohongshu" ? "xiaohongshu.search_users" : "douyin.search_users";
  const lastLoadMoreAt = useRef(0);
  const stopRequested = useRef(false);
  const manualSearch = useRef(false);

  useEffect(() => {
    const next = structured<UserCollectionResult>(initialResult);
    if (typeof initialInput.jobId === "string") setJobId(initialInput.jobId);
    else if (next?.jobId) setJobId(next.jobId);
    if (next?.kind === "users") setResult(next);
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
    const incomingResult = structured<UserCollectionResult>(initialResult);
    const incomingKeyword = typeof initialInput.keyword === "string" ? initialInput.keyword : incomingResult?.kind === "users" ? incomingResult.keyword : undefined;
    const incomingFilters = initialInput.filters && typeof initialInput.filters === "object" ? initialInput.filters as Partial<UserFilters> : incomingResult?.kind === "users" ? incomingResult.filters : undefined;
    if (incomingKeyword !== undefined) setKeyword(incomingKeyword);
    if (incomingFilters) setFilters({ ...defaultUserFilters, ...incomingFilters });
    if (initialInput.maxPages !== undefined) setTargetPages(normalizeMaxPages(initialInput.maxPages));
  }, [initialInput, initialResult]);

  useEffect(() => {
    setSelectedIds((current) => new Set([...current].filter((id) => result?.items.some((item) => userId(item) === id))));
  }, [result]);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const state = await readPersistedState(app, undefined, jobId);
        if (!active) return;
        setCurrentAccountUid(state?.login.account?.uid ?? "");
        const restoreSearchInput = initialInput.keyword === undefined && initialInput.filters === undefined;
        if (restoreSearchInput) {
          const persistedInput = state?.lastUserSearch;
          const persistedResult = state?.lastUsers;
          if (persistedInput) {
            setKeyword(persistedInput.keyword);
            setFilters({ ...defaultUserFilters, ...persistedInput.filters });
            setTargetPages(normalizeMaxPages(persistedInput.maxPages));
          } else if (persistedResult) {
            setKeyword(persistedResult.keyword);
            setFilters({ ...defaultUserFilters, ...persistedResult.filters });
          }
        }
        const progress = state?.userProgress;
        if (!progress) return;
        if (initialResult?.isError || stopRequested.current) {
          setServerCollecting(false);
          setCollecting(false);
          setBusy(false);
          setLoadingMore(false);
          return;
        }
        if (progress.status === "collecting") {
          const hasToolSearch = (typeof initialInput.keyword === "string" && initialInput.keyword.trim().length > 0) || manualSearch.current;
          if (!hasToolSearch) {
            setServerCollecting(false);
            setCollecting(false);
            setBusy(false);
            return;
          }
          setServerCollecting(true);
          setCollecting(!stopRequested.current);
          setTargetPages(progress.maxPages);
          if (progress.pages === 0) {
            setResult(undefined);
            setBusy(true);
          } else if (state.lastUsers) {
            setResult(state.lastUsers);
            setLoadedPages(Math.max(1, progress.pages));
            setBusy(false);
          } else {
            setBusy(true);
          }
          timer = window.setTimeout(() => void refresh(), 700);
          return;
        }
        setServerCollecting(false);
        setCollecting(false);
        manualSearch.current = false;
        setBusy(false);
        if (state.lastUsers) {
          setResult(state.lastUsers);
          setLoadedPages(Math.max(1, progress.pages));
        }
        if (progress.status === "error") setError(progress.message || "用户采集失败");
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
    if (!keyword.trim()) return;
    manualSearch.current = true;
    stopRequested.current = false;
    setBusy(true);
    setCollecting(true);
    setError(undefined);
    setResult(undefined);
    setSelectedIds(new Set());
    lastLoadMoreAt.current = 0;
    const requestedPages = normalizeMaxPages(initialInput.maxPages);
    setTargetPages(requestedPages);
    try {
      const response = await app.callServerTool({ name: searchToolName, arguments: platform === "xiaohongshu" ? { keyword: keyword.trim(), maxPages: 1 } : { keyword: keyword.trim(), maxPages: 1, filters } });
      const message = errorText(response);
      setError(message);
      if (message) {
        manualSearch.current = false;
        stopRequested.current = true;
        setCollecting(false);
        setServerCollecting(false);
        setLoadingMore(false);
        return;
      }
      const nextJobId = (structured<{ jobId?: unknown }>(response)?.jobId as string | undefined) ?? jobId;
      if (nextJobId) setJobId(nextJobId);
      const state = await readPersistedState(app, undefined, nextJobId);
      const next = state?.lastUsers;
      if (next) {
        setResult(next);
        setLoadedPages(next.pages ?? 1);
        setBusy(false);
        const shouldContinue = !stopRequested.current && next.hasMore !== false && requestedPages > 1;
        setCollecting(shouldContinue);
        if (!shouldContinue) await app.updateModelContext({ content: [{ type: "text", text: `本次用户采集结束：共采集页数 ${next.pages ?? 1} 页，共采集用户 ${next.items.length} 个。` }], structuredContent: { kind: next.kind, jobId: next.jobId, keyword: next.keyword, pages: next.pages, count: next.items.length } });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setCollecting(false);
    } finally {
      setBusy(false);
    }
  };

  const stopSearch = () => {
    manualSearch.current = false;
    stopRequested.current = true;
    setCollecting(false);
    setBusy(false);
    setTargetPages(loadedPages);
  };

  const loadMore = async () => {
    if (serverCollecting || stopRequested.current || loadingMore || !result || result.hasMore === false || loadedPages >= targetPages) return;
    const now = Date.now();
    if (now - lastLoadMoreAt.current < 2_500) return;
    lastLoadMoreAt.current = now;
    const nextPage = loadedPages + 1;
    setLoadingMore(true);
    setError(undefined);
    try {
      const response = await app.callServerTool({ name: searchToolName, arguments: platform === "xiaohongshu" ? { keyword: keyword.trim(), maxPages: nextPage } : { keyword: keyword.trim(), filters, maxPages: nextPage } });
      const message = errorText(response);
      setError(message);
      const state = !message ? await readPersistedState(app, undefined, jobId) : undefined;
      const next = state?.lastUsers;
      if (!message && next) {
        setResult(next);
        const actualPages = next.pages ?? nextPage;
        setLoadedPages(actualPages);
        const finished = stopRequested.current || next.hasMore === false || actualPages >= targetPages;
        if (finished) {
          setCollecting(false);
          await app.updateModelContext({ content: [{ type: "text", text: ["本次用户采集结束：", `共采集页数 ${actualPages} 页`, `共采集用户 ${next.items.length} 个`, "", "你可以继续以下操作：", next.hasMore === false ? "筛选用户或查看用户详情" : "继续翻页或筛选用户"].join("\n") }], structuredContent: { kind: "users", jobId: next.jobId, pages: actualPages, count: next.items.length } });
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setCollecting(false);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!result || busy || !collecting || loadingMore || result.hasMore === false || loadedPages >= targetPages) return;
    void loadMore();
  }, [result, busy, collecting, loadingMore, loadedPages, targetPages]);

  const filteredUsers = useMemo(() => {
    if (!result) return [];
    const minimum = (value: string): number | undefined => {
      if (!value.trim()) return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const followers = minimum(thresholds.followers);
    const likes = minimum(thresholds.likes);
    return result.items.filter((user) => (followers === undefined || user.followerCount > followers) && (likes === undefined || user.totalFavorited > likes));
  }, [result, thresholds]);

  const selectAll = () => setSelectedIds((current) => {
    const next = new Set(current);
    for (const user of filteredUsers) next.add(userId(user));
    return next;
  });
  const invertSelection = () => setSelectedIds((current) => {
    const next = new Set(current);
    for (const user of filteredUsers) {
      const id = userId(user);
      if (next.has(id)) next.delete(id); else next.add(id);
    }
    return next;
  });
  const toggleUserSelection = (id: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const deleteSelected = () => {
    if (!result || !selectedIds.size) return;
    setResult({ ...result, items: result.items.filter((user) => !selectedIds.has(userId(user))) });
    setSelectedIds(new Set());
  };
  const saveSelected = async () => {
    const users = result?.items.filter((user) => selectedIds.has(userId(user))) ?? [];
    if (!users.length) return;
    setExporting(true);
    try {
      const response = await app.callServerTool({ name: "state.save_users", arguments: { users } });
      const message = errorText(response);
      if (message) throw new Error(message);
      const saved = structured<{ filePath?: string; count?: number }>(response);
      if (!saved?.filePath) throw new Error("保存成功，但服务端没有返回文件地址");
      setExportResult({ count: saved.count ?? users.length, filePath: saved.filePath });
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExporting(false);
    }
  };
  const openUserDetail = (user: DouyinUser) => {
    const secUid = user.secUid || user.sec_uid;
    onOpenUserDetail?.({ ...user, secUid, sec_uid: secUid });
  };

  return {
    keyword, setKeyword, filters, setFilters, result, busy, collecting, loadingMore, currentAccountUid, error, selectedIds,
    thresholds, setThresholds, exporting, exportResult, setExportResult, deleteOpen, setDeleteOpen, filteredUsers, loadedPages,
    targetPages, run, stopSearch, loadMore, selectAll, invertSelection, toggleUserSelection, deleteSelected, saveSelected, openUserDetail,
  };
}
