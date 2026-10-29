export const selectors = {
  searchInput: [
    'input[placeholder*="搜索"]',
    'input[data-e2e*="search"]',
    'input[type="search"]',
  ],
} as const;

export const endpointPatterns = {
  videoSearch: [
    "/aweme/v1/web/general/search/single/",
    "/aweme/v1/web/general/search/stream/",
  ],
  userSearch: [
    "/aweme/v1/web/discover/search/",
  ],
  userPosts: [
    "/aweme/v1/web/aweme/post/",
  ],
  userProfile: [
    "/aweme/v1/web/user/profile/other/",
  ],
  xiaohongshuUserProfile: [
    "/api/sns/web/v2/user/me",
  ],
  xiaohongshuNotes: [
    "/api/sns/web/v2/search/notes",
  ],
  xiaohongshuFeed: [
    "/api/sns/web/v1/feed",
  ],
  xiaohongshuUsers: [
    "/api/sns/web/v1/search/usersearch",
  ],
  xiaohongshuUserPosted: [
    "/api/sns/web/v1/user_posted",
  ],
} as const;

export function urlMatches(url: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => url.includes(pattern));
}
