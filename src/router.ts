export type AppRoute =
  | "login"
  | "video-search"
  | "user-search"
  | "user-detail";

export type LocalRoute = "auto" | "user-detail";

export type AppPlatform = "douyin" | "xiaohongshu";

export function appTitle(platform: AppPlatform): string {
  return `${platform === "xiaohongshu" ? "小红书" : "抖音"}数据采集`;
}

export function platformForToolName(toolName: string): AppPlatform {
  const normalized = toolName.trim().toLowerCase();
  return /(^|[.:])xiaohongshu(?:[.:]|$)/.test(normalized) ? "xiaohongshu" : "douyin";
}

export function toolNameForPath(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  const platform = parts[0] === "xiaohongshu" ? "xiaohongshu" : "douyin";
  const route = parts[0] === "xiaohongshu" ? `/${parts[1] ?? "search_videos"}` : pathname;
  switch (route) {
    case "/login": return `${platform}.get_cookie`;
    case "/search_users": return `${platform}.search_users`;
    case "/user_detail": return platform === "xiaohongshu" ? "xiaohongshu.collect_user_notes" : "douyin.collect_user_videos";
    case "/search_videos":
    default: return `${platform}.search_videos`;
  }
}

export function resolvePathRoute(pathname: string): AppRoute {
  return resolveRoute(toolNameForPath(pathname));
}

/**
 * Resolve the page rendered by the single MCP App document.
 *
 * MCP Apps switch the UI resource through the tool metadata, while pages that
 * are opened from inside the same View use a local route override. Keeping
 * this mapping in one place prevents page components from depending on host
 * tool-name parsing.
 */
export function resolveRoute(toolName: string, localRoute: LocalRoute = "auto"): AppRoute {
  if (localRoute !== "auto") return localRoute;
  if (toolName.endsWith("get_cookie")) return "login";
  if (toolName.endsWith("search_users")) return "user-search";
  if (toolName.endsWith("collect_user_videos") || toolName.endsWith("collect_user_notes")) return "user-detail";
  return "video-search";
}
