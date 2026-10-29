import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { useEffect, useRef, useState } from "react";
import { EXPORT_POLL_INTERVAL_MS, exportInProgress, exportJobSchema, type ExportJob } from "../export-model";
import type { DouyinVideo } from "../server/types";
import { errorText } from "./shared";

function readJob(response: CallToolResult): ExportJob {
  const error = errorText(response);
  if (error) throw new Error(error);
  const parsed = exportJobSchema.safeParse(response.structuredContent);
  if (!parsed.success) throw new Error("保存服务返回了无效的任务状态，请更新插件后重试");
  return parsed.data;
}

export function useVideoExport(app: App, initialResult?: CallToolResult | null, initialExportId?: string) {
  const initialJob = exportJobSchema.safeParse(initialResult?.structuredContent);
  const [job, setJob] = useState<ExportJob | undefined>(initialJob.success ? initialJob.data : undefined);
  const [exportId, setExportId] = useState(initialJob.success ? initialJob.data.exportId : initialExportId);
  const [open, setOpen] = useState(initialJob.success || Boolean(initialExportId));
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const startingRef = useRef(false);
  const mounted = useRef(false);
  const initialId = initialJob.success ? initialJob.data.exportId : undefined;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (initialJob.success) { setJob(initialJob.data); setExportId(initialJob.data.exportId); setOpen(true); }
    else if (initialExportId) { setJob(undefined); setExportId(initialExportId); setOpen(true); }
  }, [initialId, initialExportId]);

  useEffect(() => {
    if (!exportId || (job && !exportInProgress(job))) return;
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      let again = true;
      try {
        const response = await app.callServerTool({ name: "state.get_export", arguments: { exportId } });
        if (!active) return;
        if (response.isError) {
          const message = errorText(response) ?? "保存任务不可用";
          setError(message);
          setJob((current) => current ? { ...current, status: "failed", error: message } : undefined);
          setExportId(undefined);
          return;
        }
        const next = readJob(response);
        if (next.exportId !== exportId) throw new Error("保存任务 ID 不匹配");
        setJob(next);
        setError(undefined);
        again = exportInProgress(next);
      } catch (cause) {
        if (active) setError(`进度暂不可用：${cause instanceof Error ? cause.message : String(cause)}。正在重试…`);
      }
      if (active && again) timer = window.setTimeout(() => void poll(), EXPORT_POLL_INTERVAL_MS);
    };
    void poll();
    return () => { active = false; window.clearTimeout(timer); };
  }, [app, exportId, job?.status]);

  const start = async (videos: DouyinVideo[]) => {
    if (startingRef.current || (exportId && (!job || exportInProgress(job)))) { setOpen(true); return; }
    if (!videos.length) return;
    startingRef.current = true;
    setStarting(true); setOpen(true); setError(undefined); setJob(undefined); setExportId(undefined);
    try {
      const response = await app.callServerTool({ name: "state.export_videos", arguments: { videos } });
      const next = readJob(response);
      if (mounted.current) {
        setJob(next); setExportId(next.exportId);
        if (window.parent === window && /^https?:$/.test(window.location.protocol)) {
          const url = new URL(window.location.href); url.searchParams.set("exportId", next.exportId);
          window.history.replaceState(null, "", url);
        }
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      startingRef.current = false;
      if (mounted.current) setStarting(false);
    }
  };

  return { job, open, setOpen, starting, error, start, exporting: starting || Boolean(exportId && (!job || exportInProgress(job))) };
}

export type VideoExportState = ReturnType<typeof useVideoExport>;
