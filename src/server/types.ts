export type LoginStatus = "idle" | "missing" | "checking" | "waiting" | "authenticated" | "expired" | "error";

export interface LoginState {
  status: LoginStatus;
  message: string;
  updatedAt: string;
  cookieCount?: number;
  account?: DouyinAccount;
}

export interface BrowserState {
  captchaDetected: boolean;
  captchaDetectedAt?: string;
  dependency?: BrowserDependencyState;
}

export interface BrowserDependencyState {
  ready: boolean;
  status: "idle" | "checking" | "ready" | "error";
  message: string;
  binaryPath?: string;
  version?: string;
  error?: string;
  updatedAt?: string;
}

export type PlatformId = "douyin" | "kuaishou" | "xiaohongshu";

export type VideoDownloadStatus = "downloaded" | "existing" | "not-video" | "missing-url" | "failed";

export interface VideoFileRecord {
  videoId: string;
  platform: PlatformId;
  localPath?: string;
  status: VideoDownloadStatus;
  size?: number;
  error?: string;
}

export interface DouyinAccount {
  uid: string;
  secUid: string;
  douyinId: string;
  uniqueId: string;
  nickname: string;
  signature: string;
  city: string;
  bindPhone: string;
  gender: number;
  avatarUrl?: string;
  followerCount: number;
  followingCount: number;
  videoCount: number;
}

export type PersistedAccountStatus = 1 | 2;

export interface PersistedDouyinAccount {
  status: PersistedAccountStatus;
  cookie?: string;
  user_agent?: string;
  avatar?: string;
  follower_count?: number;
  following_count?: number;
  nickname?: string;
  uid?: string;
  city?: string;
  bind_phone?: string;
  signature?: string;
  gender?: number;
  unique_id?: string;
}

export interface PersistedPlatformAccount {
  platform: PlatformId;
  status: PersistedAccountStatus;
  cookie?: string;
  user_agent?: string;
  profile: Record<string, unknown>;
}

export interface DouyinVideo {
  id: string;
  platform?: PlatformId;
  awemeType?: number;
  title: string;
  author: string;
  secUid: string;
  followerCount: number;
  publishedAt: string;
  durationMs: number;
  type: "video" | "image-text";
  likes: number;
  shares: number;
  favorites: number;
  comments: number;
  url: string;
  coverUrl?: string;
  playUrl?: string;
  /** Xiaohongshu detail-page token used to resolve the video stream on demand. */
  xsecToken?: string;
  localPath?: string;
  downloadStatus?: VideoDownloadStatus;
}

export interface DouyinUser {
  uid: string;
  secUid: string;
  /** Raw field name from Douyin responses, kept for persisted/exported data. */
  sec_uid: string;
  /** Douyin marks private accounts with secret === 1. */
  secret?: number;
  douyinId: string;
  nickname: string;
  signature: string;
  avatarUrl?: string;
  followerCount: number;
  totalFavorited: number;
  videoCount: number;
  /** Xiaohongshu profile access token from search results. */
  xsecToken?: string;
  profileUrl: string;
}

export type UserFollowerFilter = "all" | "under-1000" | "1000-1w" | "1w-10w" | "10w-100w" | "over-100w";
export type UserTypeFilter = "all" | "ordinary" | "enterprise" | "personal";

export interface UserFilters {
  followerCount: UserFollowerFilter;
  userType: UserTypeFilter;
}

export interface UserSearchInput {
  keyword: string;
  maxPages: number;
  filters: UserFilters;
  platform?: PlatformId;
}

export type PublishTimeFilter = "all" | "day" | "week" | "half-year";
export type DurationFilter = "all" | "short" | "medium" | "long";
export type SortFilter = "general" | "latest" | "most-liked";
export type SearchScopeFilter = "all" | "following" | "watched" | "unwatched";
export type ContentTypeFilter = "all" | "video" | "image-text";

export interface VideoFilters {
  sort: SortFilter | "most-commented" | "most-collected";
  publishTime: PublishTimeFilter;
  duration: DurationFilter;
  searchScope?: SearchScopeFilter;
  contentType?: ContentTypeFilter;
  location?: "all" | "city" | "nearby";
}

export interface VideoSearchInput {
  keyword: string;
  filters: VideoFilters;
  maxPages: number;
  platform?: PlatformId;
}

export interface VideoCollectionResult {
  kind: "videos";
  jobId?: string;
  platform?: PlatformId;
  keyword: string;
  filters: VideoFilters;
  items: DouyinVideo[];
  collectedAt: string;
  pages?: number;
  hasMore?: boolean;
}

export interface VideoListFilters {
  favoritesGt?: number;
  likesGt?: number;
  commentsGt?: number;
  type?: "all" | "video" | "image-text";
  titleContains?: string | string[];
}

export interface VideoSummary {
  id: string;
  title: string;
  type: DouyinVideo["type"];
  author: string;
  publishedAt: string;
  durationMs: number;
  duration: string;
  likes: number;
  favorites: number;
  comments: number;
  shares: number;
}

export interface VideoListResult {
  kind: "video-list";
  jobId?: string;
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  hasMore: boolean;
  items: VideoSummary[];
}

export interface VideoSearchSummary {
  kind: "video-search-summary";
  jobId?: string;
  platform?: PlatformId;
  keyword: string;
  filters: VideoFilters;
  pages: number;
  total: number;
  videoCount: number;
  imageTextCount: number;
  hasMore?: boolean;
}

export interface VideoCollectionProgress {
  status: "idle" | "collecting" | "completed" | "error";
  pages: number;
  maxPages: number;
  itemCount: number;
  message?: string;
}

export interface UserCollectionResult {
  kind: "users";
  jobId?: string;
  platform?: PlatformId;
  keyword: string;
  filters: UserFilters;
  items: DouyinUser[];
  collectedAt: string;
  pages?: number;
  hasMore?: boolean;
}

export interface UserDetailInput {
  secUid: string;
  maxPages: number;
  platform?: PlatformId;
  xsecToken?: string;
}

export interface UserDetailCollectionResult {
  kind: "user-detail";
  jobId?: string;
  secUid: string;
  user?: DouyinUser;
  items: DouyinVideo[];
  collectedAt: string;
  pages?: number;
  hasMore?: boolean;
  platform?: PlatformId;
  filePath?: string;
  profileStats?: {
    followingCount?: number;
    followerCount?: number;
    likesAndCollectsCount?: number;
  };
}

export interface UserDetailCollectionProgress {
  secUid: string;
  status: "idle" | "collecting" | "completed" | "error";
  pages: number;
  maxPages: number;
  itemCount: number;
  message?: string;
}

export interface UserDetailCache {
  sec_uid: string;
  author: Record<string, unknown>;
  aweme_list: unknown[];
  has_more?: number;
  pages?: number;
  collected_at: string;
}

export interface UserCollectionProgress {
  status: "idle" | "collecting" | "completed" | "error";
  pages: number;
  maxPages: number;
  itemCount: number;
  message?: string;
}

export interface PersistedState {
  login: LoginState;
  browser: BrowserState;
  videoProgress: VideoCollectionProgress;
  userProgress: UserCollectionProgress;
  lastVideoSearch?: VideoSearchInput;
  lastVideos?: VideoCollectionResult;
  lastUserSearch?: UserSearchInput;
  lastUsers?: UserCollectionResult;
  lastUserDetail?: UserDetailCollectionResult;
  userDetailProgress?: UserDetailCollectionProgress;
  currentUser?: DouyinUser;
}
