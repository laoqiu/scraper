export type DouyinRuntimeMode = "http" | "ui";

let mode: DouyinRuntimeMode = "http";
let httpBaseUrl: string | undefined;

export function configureRuntimeMode(next: { mode: DouyinRuntimeMode; httpBaseUrl?: string }): void {
  mode = next.mode;
  httpBaseUrl = next.httpBaseUrl;
}

export function getRuntimeMode(): DouyinRuntimeMode {
  return mode;
}

export function getHttpAppUrl(toolName?: string, jobId?: string): string | undefined {
  if (mode !== "http" || !httpBaseUrl) return undefined;
  const path = toolName ? routePathForTool(toolName) : "/";
  const query = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";
  return `${httpBaseUrl}${path}${query}`;
}

export function routePathForTool(toolName: string): string {
  let route = "/search_videos";
  if (toolName.endsWith("get_cookie")) route = "/login";
  else if (toolName.endsWith("search_users")) route = "/search_users";
  else if (toolName.endsWith("collect_user_videos")) route = "/user_detail";
  return toolName.startsWith("xiaohongshu.") ? `/xiaohongshu${route}` : route;
}
