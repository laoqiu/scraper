---
name: scraper-plugin
description: 多平台公开内容采集助手，负责按平台搜索、筛选、采集和保存视频及用户数据。
---

# scraper 采集插件操作规则

采集插件支持抖音和小红书；快手 Adapter 已预留，待提供接口样例后接入。视频文案提取和内容分析交给独立的 `video-analysis` 插件。

## 通用规则

- 工具参数根对象必须是 JSON 对象。
- `maxPages` 传 JSON 数字，例如 `5`；插件兼容数字字符串。
- 搜索工具传 `{}` 时只打开对应页面，不执行搜索；真正搜索必须传 `keyword`。
- 默认最多采集 10 页；用户明确指定时传 `maxPages`。
- 不要在每次搜索前无条件调用登录工具，只有用户要求登录或工具提示登录失效时才登录。

## 抖音

登录：`douyin.get_cookie`，参数 `{}`。

视频搜索：`douyin.search_videos`

```json
{"keyword":"儿童玩具","maxPages":5,"filters":{"contentType":"video","sort":"latest"}}
```

用户搜索：`douyin.search_users`

```json
{"keyword":"夜神月","maxPages":5,"filters":{"followerCount":"1w-10w","userType":"personal"}}
```

## 小红书

登录：`xiaohongshu.get_cookie`，参数 `{}`。

笔记搜索：`xiaohongshu.search_videos`

```json
{"keyword":"儿童玩具","maxPages":5,"filters":{"contentType":"video","sort":"most-liked"}}
```

筛选字段：`sort` 为 `general`、`latest`、`most-liked`、`most-commented`、`most-collected`；`publishTime` 为 `all`、`day`、`week`、`half-year`；`contentType` 为 `all`、`video`、`image-text`；`searchScope` 为 `all`、`following`、`watched`、`unwatched`；`location` 为 `all`、`city`、`nearby`。

用户搜索：`xiaohongshu.search_users`

```json
{"keyword":"儿童玩具","maxPages":5}
```

小红书用户搜索不支持筛选参数。

## 结果交接

需要交给 `video-analysis` 时，调用 `douyin.export_videos` 或 `xiaohongshu.export_videos`，传入搜索任务 `jobId` 和所选内容 `ids`。导出会立即返回后台任务 `exportId`，这只表示任务已提交。使用 `state.get_export`，参数 `{"exportId":"返回的保存任务 ID"}` 查询；`queued`、`running` 时继续等待并查询，不要重复提交保存任务。仅当 `status` 为 `completed` 时，从 `result.filePath`、`result.manifestPath` 读取实际文件地址，并检查下载统计。`failed`、`cancelled` 时说明失败原因，不报告保存成功。任务在插件进程结束后失效。

页面保存操作使用相同后台任务并展示进度弹窗。分析插件只接收已完成 manifest 中的 `localPath`，不重新请求平台播放地址；部分视频下载失败时，按清单记录报告并只交接已有文件。

不要臆造平台没有返回的字段，不绕过登录、验证码或平台访问控制。工具结果只使用摘要、jobId、数量、文件地址和状态，不返回页面全量源数据。
