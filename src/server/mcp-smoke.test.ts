import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

test("stdio server advertises public tools and shared MCP App resources", async () => {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const client = new Client({ name: "douyin-test", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(packageRoot, "dist", "main.js"), "--stdio", "--ui"],
    cwd: packageRoot,
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    // Keep this contract focused on capabilities that must not disappear. A
    // full sorted registry snapshot is too brittle: adding an internal or
    // app-only tool should not make the smoke test meaningless.
    for (const name of [
      "douyin.get_cookie",
      "douyin.search_videos",
      "douyin.search_users",
      "xiaohongshu.get_cookie",
      "xiaohongshu.search_videos",
      "xiaohongshu.search_users",
      "douyin.list_videos",
      "state.reload_browser_page",
    ]) {
      assert.ok(names.includes(name), `missing public tool: ${name}`);
    }
    assert.ok(tools.tools.find((tool) => tool.name === "state.get")?._meta);
    assert.ok(tools.tools.find((tool) => tool.name === "douyin.list_videos")?._meta);
    assert.ok(tools.tools.find((tool) => tool.name === "douyin.export_videos")?._meta);

    const resources = await client.listResources();
    assert.deepEqual(resources.resources.map((resource) => resource.uri).sort(), [
      "ui://scraper/douyin/login",
      "ui://scraper/douyin/search_users",
      "ui://scraper/douyin/search_videos",
      "ui://scraper/douyin/user_detail",
      "ui://scraper/xiaohongshu/login",
      "ui://scraper/xiaohongshu/search_users",
      "ui://scraper/xiaohongshu/search_videos",
      "ui://scraper/xiaohongshu/user_detail",
    ]);
    const loginTool = tools.tools.find((tool) => tool.name === "douyin.get_cookie");
    assert.equal((loginTool?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri, "ui://scraper/douyin/login");
    const resource = await client.readResource({ uri: "ui://scraper/douyin/search_videos" });
    assert.equal(resource.contents[0]?.mimeType, "text/html;profile=mcp-app");
    const content = resource.contents[0];
    assert.ok(content && "text" in content);
    assert.match(content.text, /douyin/);
    assert.match(content.text, /<title>抖音数据采集<\/title>/);
    const xiaohongshuResource = await client.readResource({ uri: "ui://scraper/xiaohongshu/search_videos" });
    const xiaohongshuContent = xiaohongshuResource.contents[0];
    assert.ok(xiaohongshuContent && "text" in xiaohongshuContent);
    assert.match(xiaohongshuContent.text, /<title>小红书数据采集<\/title>/);
    const uiPage = await client.callTool({ name: "douyin.search_videos", arguments: {} });
    assert.equal((uiPage.structuredContent as { appUrl?: string } | undefined)?.appUrl, undefined);
  } finally {
    await client.close();
  }
});

test("collection reports a missing local session without launching a browser", async () => {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "douyin-empty-"));
  const impossibleBrowserDirectory = path.join(dataDirectory, "no-browser-installed-here");
  const client = new Client({ name: "douyin-cookie-test", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(packageRoot, "dist", "main.js"), "--stdio"],
    cwd: packageRoot,
    stderr: "pipe",
    env: {
      DOUYIN_DATA_DIR: dataDirectory,
      DOUYIN_BROWSER_EXECUTABLE: path.join(impossibleBrowserDirectory, "chrome.exe"),
      LOCALAPPDATA: impossibleBrowserDirectory,
      PROGRAMFILES: impossibleBrowserDirectory,
      "PROGRAMFILES(X86)": impossibleBrowserDirectory,
    },
  });

  try {
    await client.connect(transport);
    const videosPage = await client.callTool({
      name: "douyin.search_videos",
      arguments: {},
    });
    assert.notEqual(videosPage.isError, true);
    assert.match(JSON.stringify(videosPage.structuredContent), /video-search/);
    assert.match(String((videosPage.structuredContent as { appUrl?: string }).appUrl), /^http:\/\/127\.0\.0\.1:\d+\/search_videos/);

    const tools = await client.listTools();
    const stateTool = tools.tools.find((tool) => tool.name === "state.get");
    assert.ok(stateTool, "HTTP mode must expose state tools to the browser App");
    assert.equal(stateTool._meta, undefined);
    assert.equal((await client.listResources()).resources.length, 0);

    const usersPage = await client.callTool({
      name: "douyin.search_users",
      arguments: {},
    });
    assert.notEqual(usersPage.isError, true);
    assert.match(JSON.stringify(usersPage.structuredContent), /user-search/);
    assert.match(String((usersPage.structuredContent as { appUrl?: string }).appUrl), /^http:\/\/127\.0\.0\.1:\d+\/search_users/);

    const xiaohongshuPage = await client.callTool({
      name: "xiaohongshu.search_users",
      arguments: {},
    });
    assert.notEqual(xiaohongshuPage.isError, true);
    assert.match(String((xiaohongshuPage.structuredContent as { appUrl?: string }).appUrl), /^http:\/\/127\.0\.0\.1:\d+\/xiaohongshu\/search_users/);
    const xiaohongshuHtml = await fetch(String((xiaohongshuPage.structuredContent as { appUrl?: string }).appUrl));
    assert.equal(xiaohongshuHtml.status, 200);
    assert.match(await xiaohongshuHtml.text(), /<title>小红书数据采集<\/title>/);
    const douyinHtml = await fetch(String((videosPage.structuredContent as { appUrl?: string }).appUrl));
    assert.match(await douyinHtml.text(), /<title>抖音数据采集<\/title>/);

    const emptyList = await client.callTool({
      name: "douyin.list_videos",
      arguments: {},
    });
    assert.notEqual(emptyList.isError, true);
    assert.match(JSON.stringify(emptyList.structuredContent), /"total":0/);

    const emptyExport = await client.callTool({
      name: "douyin.export_videos",
      arguments: { ids: ["missing-video"] },
    });
    assert.notEqual(emptyExport.isError, true);
    assert.match(JSON.stringify(emptyExport.structuredContent), /"count":0/);

    const emptyDelete = await client.callTool({
      name: "douyin.delete_videos",
      arguments: { ids: ["missing-video"] },
    });
    assert.notEqual(emptyDelete.isError, true);
    assert.match(JSON.stringify(emptyDelete.structuredContent), /"deletedCount":0/);

    const result = await client.callTool({
      name: "douyin.search_users",
      arguments: { keyword: "测试" },
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /get_cookie/);

    const stringFilterResult = await client.callTool({
      name: "douyin.search_users",
      arguments: { keyword: "测试", filters: '{"followerCount":"1w-10w"}' },
    });
    assert.equal(stringFilterResult.isError, true);
    assert.doesNotMatch(JSON.stringify(stringFilterResult.content), /expected object, received string/);
    assert.match(JSON.stringify(stringFilterResult.content), /get_cookie/);
  } finally {
    await client.close();
    await fs.rm(dataDirectory, { recursive: true, force: true });
  }
});
