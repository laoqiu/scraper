import { z } from "zod";

const defaultVideoFilters = {
  sort: "general",
  publishTime: "all",
  duration: "all",
  searchScope: "all",
  contentType: "all",
} as const;

const defaultXiaohongshuVideoFilters = {
  sort: "general",
  publishTime: "all",
  contentType: "all",
  searchScope: "all",
  location: "all",
} as const;

const videoFiltersObject = z.object({
  sort: z.enum(["general", "latest", "most-liked"]).default("general").describe("排序：general 综合，latest 最新，most-liked 最多点赞"),
  publishTime: z.enum(["all", "day", "week", "half-year"]).default("all").describe("发布时间：all 不限，day 一天内，week 一周内，half-year 半年内"),
  duration: z.enum(["all", "short", "medium", "long"]).default("all").describe("时长：all 不限，short 1 分钟以下，medium 1-5 分钟，long 5 分钟以上"),
  searchScope: z.enum(["all", "following", "watched", "unwatched"]).default("all").describe("搜索范围：all 不限，following 关注的人，watched 最近看过，unwatched 还未看过"),
  contentType: z.enum(["all", "video", "image-text"]).default("all").describe("内容类型：all 不限，video 视频，image-text 图文"),
}).strict();

export const videoFiltersInput = z.union([
  videoFiltersObject,
  z.string().trim().min(1, "filters JSON 字符串不能为空").transform((value, context) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      context.addIssue({ code: "custom", message: "filters 字符串必须是合法的 JSON 对象" });
      return z.NEVER;
    }
    const checked = videoFiltersObject.safeParse(parsed);
    if (!checked.success) {
      context.addIssue({
        code: "custom",
        message: "filters JSON 对象只能包含 sort、publishTime、duration、searchScope 和 contentType，且值必须符合工具说明",
      });
      return z.NEVER;
    }
    return checked.data;
  }),
]).default(defaultVideoFilters).describe("视频搜索筛选条件，可传对象或 JSON 字符串");

const xiaohongshuVideoFiltersObject = z.object({
  sort: z.enum(["general", "latest", "most-liked", "most-commented", "most-collected"]).default("general").describe("排序：general 综合，latest 最新，most-liked 最多点赞，most-commented 最多评论，most-collected 最多收藏"),
  publishTime: z.enum(["all", "day", "week", "half-year"]).default("all").describe("发布时间：all 不限，day 一天内，week 一周内，half-year 半年内"),
  contentType: z.enum(["all", "video", "image-text"]).default("all").describe("笔记类型：all 不限，video 视频，image-text 图文"),
  searchScope: z.enum(["all", "following", "watched", "unwatched"]).default("all").describe("搜索范围：all 不限，following 已关注，watched 已看过，unwatched 未看过"),
  location: z.enum(["all", "city", "nearby"]).default("all").describe("位置距离：all 不限，city 同城，nearby 附近"),
}).strict();

export const xiaohongshuVideoFiltersInput = z.union([
  xiaohongshuVideoFiltersObject,
  z.string().trim().min(1, "filters JSON 字符串不能为空").transform((value, context) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      context.addIssue({ code: "custom", message: "filters 字符串必须是合法的 JSON 对象" });
      return z.NEVER;
    }
    const checked = xiaohongshuVideoFiltersObject.safeParse(parsed);
    if (!checked.success) {
      context.addIssue({ code: "custom", message: "filters JSON 对象只能包含 sort、publishTime、contentType、searchScope 和 location，且值必须符合工具说明" });
      return z.NEVER;
    }
    return checked.data;
  }),
]).default(defaultXiaohongshuVideoFilters).describe("小红书搜索筛选条件，可传对象或 JSON 字符串");

export const userFiltersInput = z.union([
  z.object({
    followerCount: z.enum(["all", "under-1000", "1000-1w", "1w-10w", "10w-100w", "over-100w"]).default("all").describe("粉丝数：all 不限，依次为 under-1000、1000-1w、1w-10w、10w-100w、over-100w"),
    userType: z.enum(["all", "ordinary", "enterprise", "personal"]).default("all").describe("用户类型：all 不限，ordinary 普通用户，enterprise 企业认证，personal 个人认证"),
  }).strict(),
  z.string().trim().min(1, "filters JSON 字符串不能为空").transform((value, context) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      context.addIssue({ code: "custom", message: "filters 字符串必须是合法的 JSON 对象" });
      return z.NEVER;
    }
    const checked = z.object({
      followerCount: z.enum(["all", "under-1000", "1000-1w", "1w-10w", "10w-100w", "over-100w"]).default("all"),
      userType: z.enum(["all", "ordinary", "enterprise", "personal"]).default("all"),
    }).strict().safeParse(parsed);
    if (!checked.success) {
      context.addIssue({ code: "custom", message: "filters JSON 对象只能包含 followerCount 和 userType，且值必须符合工具说明" });
      return z.NEVER;
    }
    return checked.data;
  }),
]).default({ followerCount: "all", userType: "all" }).describe("用户搜索筛选条件，可传对象或 JSON 字符串");

export const videoListFiltersInput = z.object({
  favoritesGt: z.coerce.number().min(0).optional().describe("收藏数严格大于该值"),
  likesGt: z.coerce.number().min(0).optional().describe("点赞数严格大于该值"),
  commentsGt: z.coerce.number().min(0).optional().describe("评论数严格大于该值"),
  type: z.enum(["all", "video", "image-text"]).default("all").describe("内容类型"),
  titleContains: z.union([z.string().trim().min(1), z.array(z.string().trim().min(1)).min(1)]).optional().describe("标题包含的文字，支持一个字符串或字符串数组"),
}).strict().default({ type: "all" }).describe("视频列表过滤条件");

export const videoPayload = z.object({
  id: z.string().describe("视频 ID"),
  platform: z.enum(["douyin", "kuaishou", "xiaohongshu"]).optional().describe("来源平台"),
  awemeType: z.number().optional().describe("抖音内容类型编号"),
  title: z.string().describe("视频标题"),
  author: z.string().describe("作者昵称"),
  secUid: z.string().describe("作者 secUid"),
  followerCount: z.number().describe("作者粉丝数"),
  publishedAt: z.string().describe("发布时间"),
  durationMs: z.number().describe("视频时长，单位毫秒"),
  type: z.enum(["video", "image-text"]).describe("内容类型"),
  likes: z.number().describe("点赞数"),
  shares: z.number().describe("分享数"),
  favorites: z.number().describe("收藏数"),
  comments: z.number().describe("评论数"),
  url: z.string().describe("作品地址"),
  coverUrl: z.string().optional().describe("封面地址"),
  playUrl: z.string().optional().describe("播放地址"),
  xsecToken: z.string().optional().describe("小红书详情页访问 token"),
  localPath: z.string().optional().describe("本地视频文件地址"),
  downloadStatus: z.enum(["downloaded", "existing", "not-video", "missing-url", "failed"]).optional().describe("下载状态"),
});

export const userPayload = z.object({
  uid: z.string().describe("用户 UID"),
  secUid: z.string().describe("用户 secUid"),
  sec_uid: z.string().optional().default("").describe("用户 sec_uid"),
  douyinId: z.string().describe("抖音号"),
  nickname: z.string().describe("用户昵称"),
  signature: z.string().describe("用户签名"),
  avatarUrl: z.string().optional().describe("头像地址"),
  followerCount: z.number().describe("粉丝数"),
  totalFavorited: z.number().describe("获赞数"),
  videoCount: z.number().describe("作品数"),
  profileUrl: z.string().describe("用户主页地址"),
});
