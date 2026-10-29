import type { App } from "@modelcontextprotocol/ext-apps";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { ExportSuccessDialog } from "./shared";
import type { VideoExportState } from "./use-video-export";

export function VideoExportDialog({ app, state }: { app: App; state: VideoExportState }) {
  const { job, open, setOpen, error, starting } = state;
  const result = job?.status === "completed" ? job.result : undefined;
  if (result) return <ExportSuccessDialog app={app} open={open} onOpenChange={setOpen}
    title={result.failedCount ? "数据已保存，部分视频下载失败" : "数据保存完成"}
    count={result.count} filePath={result.filePath}
  />;
  const terminal = job?.status === "failed" || job?.status === "cancelled" || (!job && !starting && Boolean(error));
  const percent = job ? Math.min(99, Math.floor(job.processed * 100 / Math.max(1, job.total))) : 0;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent className="export-success-dialog">
      <DialogHeader>
        <DialogTitle>{terminal ? "保存未完成" : "正在保存数据"}</DialogTitle>
        <DialogDescription>
          {terminal ? job?.error ?? error : starting ? "正在提交保存任务…" : job?.phase === "writing" ? "正在生成 CSV 和视频清单…" : job?.phase === "downloading" ? "正在逐条处理视频…" : "任务已排队，正在等待浏览器空闲…"}
          {!terminal && <span className="export-progress-note">关闭弹窗后任务继续，可点击“查看保存进度”重新打开。</span>}
        </DialogDescription>
      </DialogHeader>
      {job && <div className="export-progress" aria-live="polite">
        <progress aria-label="保存进度" value={percent} max={100} />
        <span>已处理 {job.processed} / {job.total} 条 · {percent}%</span>
        {job.currentTitle && <span className="export-current-title">{job.currentTitle}</span>}
        <span>新下载 {job.downloadedCount} · 已有 {job.existingCount} · 失败 {job.failedCount} · 跳过 {job.skippedCount}</span>
        <span className="export-progress-note">图文或无视频地址的内容跳过视频下载，数据仍写入 CSV。</span>
      </div>}
      {error && <div role="alert" className="export-dialog-error">{error}</div>}
    </DialogContent>
  </Dialog>;
}
