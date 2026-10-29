import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Spinner } from "../components/ui/spinner";
import type { DouyinUser, PlatformId, UserFilters } from "../server/types";
import { EmptyState, ExportSuccessDialog, formatCount, LoadingRows, PageHeader, type ToolInput } from "./shared";
import { useUserSearch, userId } from "./use-user-search";

export interface UserSearchPageProps {
  app: App;
  initialInput: ToolInput;
  initialResult: CallToolResult | null;
  onOpenUserDetail?: (user: DouyinUser) => void;
  platform?: PlatformId;
}

export function UserSearchPage({ app, initialInput, initialResult, onOpenUserDetail, platform = "douyin" }: UserSearchPageProps) {
  const state = useUserSearch({ app, initialInput, initialResult, onOpenUserDetail, platform });
  const {
    keyword, setKeyword, filters, setFilters, result, busy, collecting, loadingMore, currentAccountUid, error, selectedIds,
    thresholds, setThresholds, exporting, exportResult, setExportResult, deleteOpen, setDeleteOpen, filteredUsers,
    run, stopSearch, loadMore, selectAll, invertSelection, toggleUserSelection, deleteSelected, saveSelected, openUserDetail,
  } = state;

  return <main className="page users-page">
    <PageHeader eyebrow={platform === "xiaohongshu" ? "XIAOHONGSHU DISCOVERY" : "CREATOR DISCOVERY"} title="用户采集" description="搜索公开创作者资料，并将指定用户交给 Agent 继续采集作品。" />
    <Card className="user-controls">
      <div className="user-toolbar">
        <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="输入昵称、抖音号或关键词" onKeyDown={(event) => event.key === "Enter" && void run()} />
        <Button className="primary" disabled={!collecting && !keyword.trim()} onClick={() => collecting ? stopSearch() : void run()}>{collecting ? <><Spinner />停止搜索</> : busy ? <><Spinner />搜索中…</> : "搜索用户"}</Button>
      </div>
      {platform === "douyin" && <div className="user-filters">
        <Select value={filters.followerCount} placeholder="选择粉丝数量" options={[{ value: "all", label: "选择粉丝数量" }, { value: "under-1000", label: "1000以下" }, { value: "1000-1w", label: "1000-1w" }, { value: "1w-10w", label: "1w-10w" }, { value: "10w-100w", label: "10w-100w" }, { value: "over-100w", label: "100w以上" }]} onValueChange={(value) => setFilters({ ...filters, followerCount: value as UserFilters["followerCount"] })} />
        <Select value={filters.userType} placeholder="选择用户类型" options={[{ value: "all", label: "选择用户类型" }, { value: "ordinary", label: "普通用户" }, { value: "enterprise", label: "企业认证" }, { value: "personal", label: "个人认证" }]} onValueChange={(value) => setFilters({ ...filters, userType: value as UserFilters["userType"] })} />
      </div>}
    </Card>
    <div className="video-actions user-actions">
      <div className="video-thresholds user-thresholds">
        <Input type="number" min="0" placeholder="粉丝数 >" value={thresholds.followers} onChange={(event) => setThresholds({ ...thresholds, followers: event.target.value })} />
        <Input type="number" min="0" placeholder="获赞数 >" value={thresholds.likes} onChange={(event) => setThresholds({ ...thresholds, likes: event.target.value })} />
      </div>
      <div className="video-batch-actions">
        <span>{filteredUsers.length} 条显示 / {selectedIds.size} 条已选</span>
        <Button variant="secondary" onClick={selectAll}>全选</Button>
        <Button variant="secondary" onClick={invertSelection}>反选</Button>
        <Button variant="secondary" onClick={() => void saveSelected()} disabled={!selectedIds.size || exporting}>{exporting ? "正在保存…" : "保存数据"}</Button>
        <Button variant="secondary" onClick={() => setDeleteOpen(true)} disabled={!selectedIds.size}>删除</Button>
      </div>
    </div>
    <div className="user-results" onScroll={(event) => {
      const element = event.currentTarget;
      if (element.scrollTop + element.clientHeight >= element.scrollHeight - 80) void loadMore();
    }}>
      {error && <div className="error-banner">{error}</div>}
      {!result && !busy && !collecting && <EmptyState title="搜索创作者" detail="输入关键词后，采集结果会以用户卡片展示。" />}
      {busy && !result && <LoadingRows />}
      {result && <div className="user-list">{filteredUsers.map((user) => {
        const id = userId(user);
        const isPrivateAccount = user.secret === 1;
        const isCurrentAccount = Boolean(currentAccountUid && user.uid && user.uid === currentAccountUid);
        const collectionDisabledReason = platform === "xiaohongshu" ? (user.videoCount > 0 ? undefined : "该用户没有公开笔记") : isPrivateAccount ? "私密账号无法采集" : isCurrentAccount ? "当前登录账号无法采集" : undefined;
        return <article className={`user-card${selectedIds.has(id) ? " selected" : ""}`} key={id} onClick={(event) => {
          if ((event.target as HTMLElement).closest(".user-select-checkbox")) return;
          toggleUserSelection(id);
        }}>
          <Checkbox className="user-select-checkbox" checked={selectedIds.has(id)} onClick={(event) => event.stopPropagation()} onChange={() => toggleUserSelection(id)} />
          <div className="avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user.nickname.slice(0, 1)}</div>
          <div className="user-copy"><h3>{user.nickname || "未命名用户"}</h3><p>{user.signature || "暂无简介"}</p><div className="metrics">{platform === "xiaohongshu" ? <><span>笔记 {formatCount(user.videoCount)}</span><span>粉丝 {formatCount(user.followerCount)}</span></> : <><span>抖音号 @{user.douyinId || "-"}</span><span>粉丝 {formatCount(user.followerCount)}</span><span>获赞 {formatCount(user.totalFavorited)}</span></>}</div></div>
          <Button className="link-button user-detail-button" variant="secondary" disabled={!(user.secUid || user.sec_uid) || Boolean(collectionDisabledReason)} title={collectionDisabledReason} onClick={(event) => { event.stopPropagation(); openUserDetail(user); }}>{platform === "xiaohongshu" ? "采集用户笔记" : "采集用户视频"}</Button>
        </article>;
      })}</div>}
      {loadingMore && <div className="load-more-state">正在加载更多用户…</div>}
      {result && result.hasMore === false && <div className="load-more-state">没有更多用户了</div>}
    </div>
    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <DialogContent className="video-delete-dialog">
        <DialogHeader><DialogTitle>确认删除用户</DialogTitle><DialogDescription>确定要从当前用户列表中删除已选的 {selectedIds.size} 个用户吗？此操作不会影响抖音账号。</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="secondary" onClick={() => setDeleteOpen(false)}>取消</Button><Button className="primary" onClick={() => { deleteSelected(); setDeleteOpen(false); }}>确认删除</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <ExportSuccessDialog app={app} open={Boolean(exportResult)} onOpenChange={(open) => { if (!open) setExportResult(undefined); }} count={exportResult?.count ?? 0} filePath={exportResult?.filePath ?? ""} />
  </main>;
}
