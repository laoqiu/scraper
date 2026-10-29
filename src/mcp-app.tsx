import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { HttpAppClient } from "./http-app-client";
import { appTitle, platformForToolName, resolveRoute, toolNameForPath, type LocalRoute } from "./router";
import { LoginPage } from "./pages/login-page";
import { CaptchaDialog, PageMessage, type ToolInput } from "./pages/shared";
import { UserDetailPage } from "./pages/user-detail-page";
import { UserSearchPage } from "./pages/user-search-page";
import { VideoSearchPage } from "./pages/video-search-page";
import type { DouyinUser, PlatformId } from "./server/types";

type AppViewProps = {
  app: App;
  toolInput: ToolInput;
  toolResult: CallToolResult | null;
  hostContext?: McpUiHostContext;
};

function AppView({ app, toolInput, toolResult, hostContext }: AppViewProps) {
  const [localRoute, setLocalRoute] = useState<LocalRoute>("auto");
  const [effectiveToolInput, setEffectiveToolInput] = useState<ToolInput>(toolInput);
  const [selectedUser, setSelectedUser] = useState<DouyinUser>();
  const [userDetailInput, setUserDetailInput] = useState<ToolInput>({});

  useEffect(() => setLocalRoute("auto"), [toolInput]);

  const route = resolveRoute(hostContext?.toolInfo?.tool.name ?? "", localRoute);
  const toolName = hostContext?.toolInfo?.tool.name ?? "";
  const resultPlatform = (toolResult?.structuredContent as { platform?: PlatformId } | undefined)?.platform;
  const platform: PlatformId = toolName.startsWith("state.") && resultPlatform === "xiaohongshu" ? "xiaohongshu" : platformForToolName(toolName);
  useEffect(() => {
    document.title = appTitle(platform);
  }, [platform]);
  useEffect(() => {
    let active = true;
    setEffectiveToolInput(toolInput);
    if (route !== "user-detail" || typeof toolInput.jobId !== "string" || toolInput.secUid) return () => { active = false; };
    void app.callServerTool({ name: "state.get", arguments: { jobId: toolInput.jobId } }).then((response) => {
      if (!active) return;
      const state = (response.structuredContent as { state?: { lastUserDetail?: { secUid?: string } } } | undefined)?.state;
      const secUid = state?.lastUserDetail?.secUid;
      if (secUid) setEffectiveToolInput({ ...toolInput, secUid });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [app, route, toolInput]);

  const pageInput = effectiveToolInput;
  let page;
  switch (route) {
    case "login":
      page = <LoginPage app={app} initialResult={toolResult} platform={platform} />;
      break;
    case "user-search":
      page = <UserSearchPage app={app} initialInput={pageInput} initialResult={toolResult} platform={platform} onOpenUserDetail={(user) => {
        setSelectedUser(user);
        setUserDetailInput({ secUid: user.secUid, xsecToken: user.xsecToken, maxPages: 10 });
        setLocalRoute("user-detail");
      }} />;
      break;
    case "user-detail":
      page = <UserDetailPage app={app} initialInput={localRoute === "auto" ? pageInput : userDetailInput} initialResult={toolResult} user={selectedUser} isToolEntry={localRoute === "auto"} platform={platform} />;
      break;
    case "video-search":
    default:
      page = <VideoSearchPage app={app} initialInput={pageInput} initialResult={toolResult} platform={platform} />;
      break;
  }

  return <>
    <CaptchaDialog app={app} />
    {page}
  </>;
}

function McpAppRoot() {
  const [toolInput, setToolInput] = useState<ToolInput>({});
  const [toolResult, setToolResult] = useState<CallToolResult | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext>();

  const { app, error } = useApp({
    appInfo: { name: "scraper", version: "0.1.0" },
    capabilities: {},
    onAppCreated: (created) => {
      created.ontoolinput = (input) => {
        setToolInput(input.arguments ?? {});
        setToolResult(null);
      };
      created.ontoolresult = (result) => setToolResult(result);
      created.ontoolcancelled = ({ reason }) => {
        setToolResult({ isError: true, content: [{ type: "text", text: reason ?? "工具调用已取消" }] });
      };
      created.onhostcontextchanged = (next) => setHostContext((current) => ({ ...current, ...next }));
      created.onteardown = async () => ({});
      created.onerror = (cause) => console.error("[scraper-ui]", cause);
    },
  });

  useEffect(() => {
    if (!app) return;
    setHostContext(app.getHostContext());
  }, [app]);

  if (error) return <PageMessage title="界面加载失败" detail={error.message || String(error)} />;
  if (!app) return <PageMessage title="正在连接采集服务…" />;
  return <AppView app={app} toolInput={toolInput} toolResult={toolResult} hostContext={hostContext} />;
}

function HttpAppRoot() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const pathToolName = toolNameForPath(window.location.pathname);
  const toolName = useMemo(() => {
    const legacyTool = params.get("tool");
    return legacyTool && (window.location.pathname === "/" || window.location.pathname === "/app")
      ? legacyTool
      : pathToolName;
  }, [params, pathToolName]);
  const input = useMemo<ToolInput>(() => {
    const raw = params.get("input");
    const jobId = params.get("jobId");
    let parsed: ToolInput = {};
    if (raw) {
      try {
        const value = JSON.parse(raw);
        if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as ToolInput;
      } catch {
        parsed = {};
      }
    }
    const exportId = params.get("exportId");
    return { ...parsed, ...(jobId ? { jobId } : {}), ...(exportId ? { exportId } : {}) };
  }, [params]);
  const app = useMemo(() => new HttpAppClient(`${window.location.origin}/mcp`, toolName).asApp(), [toolName]);
  const hostContext = useMemo(() => app.getHostContext(), [app]);
  return <AppView app={app} toolInput={input} toolResult={null} hostContext={hostContext} />;
}

function Root() {
  const isDirectHttp = window.parent === window
    && (window.location.protocol === "http:" || window.location.protocol === "https:");
  return isDirectHttp ? <HttpAppRoot /> : <McpAppRoot />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Root /></StrictMode>);
