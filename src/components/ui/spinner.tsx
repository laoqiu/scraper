export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`ui-spinner ${className}`.trim()} role="status" aria-label="加载中" />;
}
