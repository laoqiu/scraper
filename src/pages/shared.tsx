import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/client";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import type { DouyinAccount, PersistedState, UserFilters, VideoCollectionResult, VideoFilters } from "../server/types";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../components/ui/empty";
import { Skeleton } from "../components/ui/skeleton";
import { copyWithFallback } from "../clipboard";
import { canUpdateModelContext } from "../host-capability";

export type ToolInput = Record<string, unknown>;
export type AppTool = App;

export const DEFAULT_MAX_PAGES = 10;
export const MAX_PAGES = 50;
export const defaultFilters: VideoFilters = { sort: "general", publishTime: "all", duration: "all", searchScope: "all", contentType: "all" };
export const defaultUserFilters: UserFilters = { followerCount: "all", userType: "all" };

export function normalizeMaxPages(value: unknown): number {
  const pages = Number(value);
  if (!Number.isFinite(pages)) return DEFAULT_MAX_PAGES;
  return Math.min(MAX_PAGES, Math.max(1, Math.floor(pages)));
}

export function structured<T>(result: CallToolResult | null | undefined): T | undefined {
  return result?.structuredContent as T | undefined;
}

export function errorText(result: CallToolResult): string | undefined {
  if (!result.isError) return undefined;
  const item = result.content?.find((entry) => entry.type === "text");
  return item?.type === "text" ? item.text : "操作失败";
}

export async function readPersistedState(app: App, secUid?: string, jobId?: string): Promise<PersistedState | undefined> {
  const response = await app.callServerTool({
    name: "state.get",
    arguments: { ...(secUid ? { secUid } : {}), ...(jobId ? { jobId } : {}) },
  });
  return structured<{ state?: PersistedState }>(response)?.state;
}

export function CaptchaDialog({ app }: { app: App }) {
  const CAPTCHA_POLL_INTERVAL_MS = 5_000;
  const [open, setOpen] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [acknowledgeError, setAcknowledgeError] = useState<string>();

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const state = await readPersistedState(app);
        if (!active) return;
        if (state?.browser.captchaDetected) setOpen(true);
        timer = window.setTimeout(() => void refresh(), CAPTCHA_POLL_INTERVAL_MS);
      } catch {
        if (active) timer = window.setTimeout(() => void refresh(), CAPTCHA_POLL_INTERVAL_MS);
      }
    };
    void refresh();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [app]);

  const acknowledge = async () => {
    setAcknowledging(true);
    setAcknowledgeError(undefined);
    try {
      const response = await app.callServerTool({
        name: "state.acknowledge_captcha",
        arguments: {},
      });
      const message = errorText(response);
      if (message) throw new Error(message);
      setOpen(false);
    } catch (cause) {
      setAcknowledgeError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAcknowledging(false);
    }
  };

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent className="captcha-dialog">
      <DialogHeader>
        <DialogTitle>检测到验证码</DialogTitle>
        <DialogDescription>
          检测到验证码，需要人工处理，完成以后点击继续执行。
          请在浏览器窗口中完成验证。
          {acknowledgeError && <span className="export-dialog-error">{acknowledgeError}</span>}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button className="primary" disabled={acknowledging} onClick={() => void acknowledge()}>
          {acknowledging ? "正在确认…" : "知道了"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function formatCount(value: number): string {
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)}万`;
  return String(value);
}

export function loginSummary(account: DouyinAccount): string {
  return [
    "用户登录成功",
    "",
    `昵称：${account.nickname || "-"}`,
    `关注：${account.followingCount}`,
    `粉丝：${account.followerCount}`,
    "",
    "- 根据关键词搜索视频",
    "- 根据关键词搜索账号",
  ].join("\n");
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PageMessage({ title, detail }: { title: string; detail?: string }) {
  return <main className="page centered"><div className="state-card"><div className="spinner" /><h2>{title}</h2>{detail && <p>{detail}</p>}</div></main>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{actions ?? <div className="brand-dot" />}</header>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <Empty>
    <EmptyMedia variant="icon">⌁</EmptyMedia>
    <EmptyHeader><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{detail}</EmptyDescription></EmptyHeader>
  </Empty>;
}

export function LoadingRows() {
  return <div className="loading-list">{[0, 1, 2].map((item) => <div className="loading-row" key={item}><span /><div><i /><i /></div></div>)}</div>;
}

export function VideoSkeletonGrid() {
  return <div className="card-grid video-skeleton-grid">{[0, 1, 2, 3].map((item) => <article className="video-skeleton-card" key={item}>
    <Skeleton className="video-skeleton-cover" />
    <div className="video-skeleton-body"><Skeleton className="video-skeleton-line wide" /><Skeleton className="video-skeleton-line" /><Skeleton className="video-skeleton-line short" /></div>
  </article>)}</div>;
}

export function ExportSuccessDialog({
  app,
  open,
  onOpenChange,
  count,
  filePath,
  title = "数据保存成功",
  resultText,
}: {
  app: App;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  filePath: string;
  title?: string;
  resultText?: string;
}) {
  const copyField = useRef<HTMLTextAreaElement>(null);
  const [manualCopy, setManualCopy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionDone, setActionDone] = useState(false);
  const [error, setError] = useState<string>();
  const canUpdateSession = canUpdateModelContext(app);
  const summary = resultText ?? `当前导出数据 ${count} 条：\n文件地址：${filePath}`;

  useEffect(() => {
    if (!open) return;
    setActionDone(false);
    setManualCopy(false);
    setError(undefined);
    // Keep the session context update invisible. The visible operation is
    // always copying the saved result; MCP-capable hosts receive the same
    // summary automatically when this dialog opens.
    if (canUpdateSession) {
      void app.updateModelContext({
        content: [{ type: "text", text: summary }],
        structuredContent: { kind: "export", count, filePath },
      }).catch((cause) => {
        console.warn("更新会话上下文失败", cause);
      });
    }
  }, [app, canUpdateSession, count, filePath, open, summary]);

  const openFolder = async () => {
    setOpening(true);
    setError(undefined);
    try {
      const response = await app.callServerTool({
        name: "state.open_folder",
        arguments: { filePath },
      });
      const message = errorText(response);
      if (message) throw new Error(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOpening(false);
    }
  };

  useEffect(() => {
    if (manualCopy) { copyField.current?.focus(); copyField.current?.select(); }
  }, [manualCopy]);

  const copyResult = async () => {
    setActionBusy(true);
    setError(undefined);
    setActionDone(false);
    try {
      const copied = await copyWithFallback(summary,
        navigator.clipboard?.writeText ? (text) => navigator.clipboard.writeText(text) : undefined,
        () => {
          const field = copyField.current;
          if (!field) return false;
          const previous = document.activeElement;
          const selection = document.getSelection();
          const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
          try {
            field.focus(); field.select(); field.setSelectionRange(0, field.value.length);
            return document.execCommand("copy");
          } finally {
            if (previous instanceof HTMLElement) previous.focus();
            selection?.removeAllRanges();
            for (const range of ranges) selection?.addRange(range);
          }
        });
      setActionDone(copied);
      setManualCopy(!copied);
      if (!copied) { copyField.current?.focus(); copyField.current?.select(); }
    } finally {
      setActionBusy(false);
    }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="export-success-dialog">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          已保存 {count} 条数据。
          <span className="export-file-path">
            {filePath}
            <button className="export-folder-link" type="button" disabled={opening} onClick={() => void openFolder()}>
              <FolderOpen size={14} />
              打开文件夹
            </button>
          </span>
          {resultText && <span className="export-result-details">{resultText.split("\n").slice(2).join("\n")}</span>}
          {error && <span className="export-dialog-error">{error}</span>}
        </DialogDescription>
      </DialogHeader>
      <div className={manualCopy ? "export-copy-manual" : "export-copy-probe"}>
        {manualCopy && <label htmlFor="export-copy-content">浏览器限制了自动复制，请在下方按 Ctrl+C（Mac：⌘C）复制。</label>}
        <textarea id="export-copy-content" ref={copyField} aria-label="保存结果内容" readOnly value={summary} rows={5} tabIndex={manualCopy ? 0 : -1} onFocus={(event) => event.currentTarget.select()} />
      </div>
      <DialogFooter>
        <Button className="primary" disabled={actionBusy} onClick={() => void copyResult()}>
          {actionBusy ? "正在复制…" : actionDone ? "已复制" : "复制内容"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export type { App, CallToolResult, DouyinAccount, PersistedState, UserFilters, VideoCollectionResult, VideoFilters };
