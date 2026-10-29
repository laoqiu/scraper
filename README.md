# scraper

面向 Agent Plugin 宿主的多平台公开内容采集插件。一次安装后由平台 Adapter 负责各自的登录、搜索、筛选、响应监听和数据解析；公共浏览器、结果存储、播放代理和下载交接逻辑只实现一次。

当前已接通抖音和小红书的采集流程，并保留快手 Adapter 入口。每个平台的接口监听、筛选操作和字段解析都在各自 Adapter 中维护，不复制抖音采集器。视频文案提取和内容分析属于独立的 `video-analysis` 插件。

## 运行

```bash
npm install
npm run build
node dist/main.js --stdio
```

默认启动的是 HTTP App 模式：进程会同时提供标准 MCP stdio 接口和一个本地
HTTP App 地址。工具结果会返回该地址，浏览器直接访问即可使用完整页面。
如果由支持 MCP Apps 的 GenAgent 启动，则追加 `--ui`，此时挂载同一份页面为
MCP App 资源，不启动 HTTP App 服务；视频播放代理仍按需启动：

```bash
node dist/main.js --stdio --ui
```

生产构建会将前端 MCP App 编译为单个 HTML，并将服务端从 `main.ts` 打包为单个 `dist/main.js`，同时压缩和混淆变量名，不生成 sourcemap，也不会把 TypeScript 声明文件放入 `dist`。SQLite 建表 SQL 作为 `dist/schema.sql` 独立资源加载，不内联到 JavaScript。第三方 Node 依赖保持 external，尤其是 `better-sqlite3` 原生模块。分发时将 `dist`、`skills`、`plugin.json`、`mcp.json`、`package.json` 和生产依赖一起打包即可；源码仍只保留在开发目录中。

插件启动成功后，宿主会动态加入插件根目录下的 `skills` 目录；插件停止后移除。当前内置的 `scraper-plugin` skill 负责指导模型正确调用不同平台工具、筛选字段和参数格式。

标准 MCP 客户端可使用以下配置启动（默认是 HTTP App 模式）：

```json
{
  "mcpServers": {
    "scraper": {
      "command": "node",
      "args": ["<安装目录>/dist/main.js", "--stdio"]
    }
  }
}
```

## 在 WorkBuddy 中自动安装

将[安装说明链接](https://raw.githubusercontent.com/laoqiu/scraper/main/INSTALL_WORKBUDDY.md)发给 WorkBuddy，并让它按文档安装 scraper MCP，即可由它完成下载、构建、配置和连接验证，无需复制整段提示词。

也可以在 GitHub 上[查看安装说明](./INSTALL_WORKBUDDY.md)。

## 浏览器配置

浏览器使用 `puppeteer-core` 控制本机已安装的 Chrome、Microsoft Edge 或 Chromium，安装依赖和启动插件均不会下载浏览器内核。Windows 自动查找用户目录和系统安装目录，macOS 自动查找系统及用户的 Applications 目录，Linux 查找 PATH、/usr/bin、/usr/local/bin 和 /snap/bin。

启动时通过 `puppeteer-extra` 默认启用 `puppeteer-extra-plugin-stealth`，减少 `navigator.webdriver` 等自动化特征。浏览器保持有界面模式并复用插件专用的持久化 profile。Stealth 不能保证避开平台风控，遇到验证码仍需用户在浏览器中完成验证。

可以在 `mcp.json` 的 `mcpServers.scraper.env.DOUYIN_BROWSER_EXECUTABLE` 中指定浏览器可执行文件的完整路径，例如 Windows 的 `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`。留空则自动查找。显式配置的路径无效时会直接报错；本机未安装支持的浏览器时，需要先安装浏览器或指定已有浏览器路径。修改配置后重启插件。

旧版的 `CLOAKBROWSER_DOWNLOAD_URL` 和 `CLOAKBROWSER_BINARY_PATH` 配置不再使用；已有浏览器路径配置请改为 `DOUYIN_BROWSER_EXECUTABLE`。通过 `DOUYIN_DATA_DIR` 指定数据目录。

浏览器接入版本锁定为 `puppeteer-extra@3.3.6`、`puppeteer-extra-plugin-stealth@2.11.2`，由现有的 `puppeteer-core@24.43.1` 驱动。可以运行 `npm run test:browser`，使用临时 profile 检查真实浏览器启动、Stealth 特征及 Cookie 重启持久化；该检查不访问外部站点，也不使用现有登录数据。

浏览器使用 MCP 数据目录下固定的 `browser-profile/Default` 持久化 profile，工具调用和 MCP 重启都会复用它。SQLite 只保存账号、公共状态和操作记录；视频、用户结果保存为结果 JSON 文件，页面通过这些文件读取数据，不使用浏览器 `localStorage`。

## 工具

- `douyin.get_cookie`
- `douyin.search_videos`、`douyin.search_users`
- `douyin.list_videos`、`douyin.export_videos`、`douyin.delete_videos`
- `douyin.play_video`
- `xiaohongshu.get_cookie`
- `xiaohongshu.search_videos`、`xiaohongshu.search_users`
- `xiaohongshu.export_videos`、`state.get_export`
- 文案提取和内容分析不属于本插件，请使用独立的 `video-analysis` 插件。

HTTP 模式与 MCP App 模式共用同一个前端文档和路由：HTTP 模式按路径打开页面，
MCP App 模式通过 `ui://scraper/...` 资源打开页面。工具结果只在 HTTP 模式附加
`appUrl`；MCP App 模式直接使用宿主提供的工具调用能力。页面会检测宿主是否提供
`ui/message` 或 `ui/update-model-context`，显示“直接通讯”或“复制内容”能力状态。

## 采集结果交接

调用 `douyin.export_videos`、`xiaohongshu.export_videos` 或页面上的保存操作时，服务立即返回后台任务的 `exportId`，下载和文件写入在后台执行：

- 导出视频元数据 CSV；
- 将视频文件保存到插件数据目录的 `videos/`；
- 生成 `video-manifests/videos_<时间戳>_<唯一标识>.json`。

页面弹窗显示排队、下载、生成文件三个阶段，以及已处理数量和新下载、已有、失败、跳过数量。关闭弹窗后任务继续，可用“查看保存进度”或“查看上次保存结果”重新打开。HTTP 页面会将 exportId 保留在当前地址，刷新后继续查询同一任务。

工具调用方须使用 `state.get_export`，参数 `{"exportId":"返回的任务 ID"}` 查询进度。`queued` / `running` 表示仍在处理；`completed` 的 `result` 返回 `filePath`、`manifestPath`、`batchId` 和下载统计；`failed` / `cancelled` 返回 `error`，不要当作保存成功。不同任务按队列执行，不会互相覆盖进度。单次视频传输最多等待 120 秒，失败会记录并继续下一条；图文和没有视频地址的内容跳过视频下载，元数据仍保存。

后台任务仅在当前插件进程内有效，停止插件会取消未完成任务，不支持重启续传。已完成任务状态最多保留一小时，总记录上限 100；容量不足时优先清理已结束记录，已生成的文件继续保留。

“复制内容”先使用 Clipboard API；宿主拒绝权限时尝试兼容复制。两种方式都受限时，弹窗显示可选中的完整文本，按 Ctrl+C（Mac：⌘C）手动复制。

manifest 是采集插件与 `video-analysis` 的交接协议。分析插件只读取其中的
`localPath`，不依赖浏览器、平台 Cookie 或采集插件运行状态。重复保存同一个视频会复用已有文件。

## 源码结构

- `src/server/browser/`：浏览器内部 SDK。`index.ts` 是服务端对浏览器能力的统一出口；浏览器生命周期、登录、采集会话、网络响应监听、播放代理和视频下载都集中在这里。
- `src/server/platform/`：平台 Adapter 注册表。每个平台只维护自身站点 URL、媒体域名和后续接口解析扩展点。
- `src/server/mcp/`：MCP 工具、App 资源和摘要响应。根目录 `server.ts` 只负责组装工具与资源。
- `src/server/export-jobs.ts`、`src/server/video-export.ts`：后台保存任务队列、进度和关闭清理；工具只负责参数与响应转换。
- `src/pages/use-video-export.ts`、`src/pages/video-export-dialog.tsx`：两平台共用的任务查询与进度弹窗。
- `src/server/store.ts`：公共状态、账号和数据库生命周期。
- `src/server/collection-repository.ts`：采集操作元数据和结果 JSON 文件的读写。
- `src/pages/use-video-collection.ts`：视频采集页的分页、筛选、选择和保存动作；页面文件只负责 UI 组合。

浏览器实现不要被工具模块直接引用具体文件；新增浏览器能力时，优先加入 `src/server/browser/`，再从 `browser/index.ts` 暴露稳定的调用入口。
