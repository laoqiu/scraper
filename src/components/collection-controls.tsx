import type { ReactNode } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export interface VideoMetricThresholds {
  favorites: string;
  comments: string;
  likes: string;
}

export function VideoMetricFilters({
  value,
  onChange,
}: {
  value: VideoMetricThresholds;
  onChange: (value: VideoMetricThresholds) => void;
}) {
  return <div className="video-thresholds">
    <Input type="number" min="0" placeholder="收藏数 >" value={value.favorites} onChange={(event) => onChange({ ...value, favorites: event.target.value })} />
    <Input type="number" min="0" placeholder="评论数 >" value={value.comments} onChange={(event) => onChange({ ...value, comments: event.target.value })} />
    <Input type="number" min="0" placeholder="点赞数 >" value={value.likes} onChange={(event) => onChange({ ...value, likes: event.target.value })} />
  </div>;
}

export function SelectionActions({
  visibleCount,
  selectedCount,
  onSelectAll,
  onInvert,
  onDelete,
  children,
}: {
  visibleCount: number;
  selectedCount: number;
  onSelectAll: () => void;
  onInvert: () => void;
  onDelete: () => void;
  children?: ReactNode;
}) {
  return <div className="video-batch-actions">
    <span>{visibleCount} 条显示 / {selectedCount} 条已选</span>
    <Button variant="secondary" onClick={onSelectAll}>全选</Button>
    <Button variant="secondary" onClick={onInvert}>反选</Button>
    <Button variant="secondary" onClick={onDelete} disabled={!selectedCount}>删除</Button>
    {children}
  </div>;
}
