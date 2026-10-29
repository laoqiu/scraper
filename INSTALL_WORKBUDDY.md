# 在 WorkBuddy 中安装 scraper MCP

本文件是供 WorkBuddy 读取并执行的安装说明。用户让你按此文档安装 scraper 时，请完成以下操作。

请帮我安装并配置 scraper MCP 服务，仓库地址：
https://github.com/laoqiu/scraper.git

请实际执行以下步骤，并在最后报告安装目录、配置位置和连接验证结果：

1. 检查 Git、Node.js 和 npm；Node.js 需为 22.12 或更高版本，并满足仓库依赖的 engines 要求。缺少依赖时说明并协助安装。
2. 将仓库克隆到用户目录下的 mcp-services/scraper，使用绝对路径。若目录已存在，先检查是否为同一仓库；有本地修改时保留修改，干净的同源仓库可执行 git pull --ff-only 更新。
3. 阅读 README.md 和 skills/scraper-plugin/SKILL.md，在仓库根目录执行 npm ci、npm run build 和 npm test。若安装或构建失败，先解决问题，再继续配置。
4. 检查本机已有的 Chrome、Microsoft Edge 或 Chromium。scraper 使用 puppeteer-core，不需要下载浏览器内核；如未找到支持的浏览器，明确告诉我需要先安装哪个浏览器。
5. 备份已有的用户级 ~/.workbuddy/mcp.json，将 scraper 合并到 mcpServers 中，保留其他服务和配置。文件不存在时创建它。scraper 配置使用：

   - command：本机 node 可执行文件的绝对路径。
   - args：[安装目录下 dist/main.js 的绝对路径, "--stdio"]。
   - env.DOUYIN_DATA_DIR：用户目录下 mcp-data/scraper 的绝对路径，用于保存账号、浏览器 profile、采集结果和下载文件。
   - 如需指定已安装的浏览器，在 env.DOUYIN_BROWSER_EXECUTABLE 中填写浏览器可执行文件的绝对路径；否则省略该项，使用自动查找。

   所有路径必须展开为实际绝对路径；Windows JSON 路径使用正斜杠。使用默认 HTTP App 模式，不添加 --ui，也不照搬 ${PLUGIN_ROOT} 等插件宿主占位符。

6. 让 WorkBuddy 重新加载 MCP 配置，通过 MCP initialize 和 tools/list 验证连接，确认能列出 douyin.search_videos 和 xiaohongshu.search_videos。若当前会话无法重新加载，给出重启或重新连接的具体操作，待重新加载后再验证，不要仅凭配置写入就报告连接成功。
7. 安装验证只检查服务连接和工具列表；需要采集时，再由我在浏览器中登录对应平台。

WorkBuddy 的用户级 MCP 配置位置和配置格式可参见 [WorkBuddy 官方 MCP 指南](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide)。WorkBuddy 使用本地 stdio 服务；工具返回的 `appUrl` 可在浏览器中打开采集界面。
