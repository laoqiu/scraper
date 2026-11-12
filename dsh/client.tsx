import { useEffect, useRef, useState } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { ClientConnectionRpc, ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type { PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { specTypeSchemas, type StandardSchemaV1Sync } from "@modelcontextprotocol/client";
import { z } from "zod";
import { appPath, CALL_TOOL, CHANNEL, RESOURCE, resourceCsp } from "./protocol.js";

const TAB = "@dsh-private/dsh-scraper";
const zh = {
  title: "数据采集", choosePage: "采集页面", loading: "正在加载采集页面…",
  failed: "采集页面加载失败", retry: "重试", douyin: "抖音", xiaohongshu: "小红书",
  videos: "搜索视频", notes: "搜索笔记", users: "搜索用户", login: "登录",
};
const en: typeof zh = {
  title: "Scraper", choosePage: "Scraper page", loading: "Loading scraper…",
  failed: "Could not load scraper", retry: "Retry", douyin: "Douyin", xiaohongshu: "Xiaohongshu",
  videos: "Search videos", notes: "Search notes", users: "Search users", login: "Sign in",
};

declare module "@deepseek-ai/cordis" {
  interface Context { connection: ConnectionHandle }
}
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap { scraper: keyof typeof zh }
}

function fromMcpSchema<T>(schema: StandardSchemaV1Sync<unknown, T>) {
  return z.unknown().transform((input, ctx) => {
    const result = schema["~standard"].validate(input);
    if (!result.issues) return result.value;
    for (const issue of result.issues) ctx.addIssue({ code: "custom", message: issue.message });
    return z.NEVER;
  });
}

const appResource = z.object({ html: z.string(), tool: fromMcpSchema(specTypeSchemas.Tool), csp: resourceCsp });
const callToolResult = fromMcpSchema(specTypeSchemas.CallToolResult);
type AppPath = z.infer<typeof appPath>;
type PanelProps = PropsLocale<"scraper"> & { rpc: ClientConnectionRpc };

async function request<T>(rpc: ClientConnectionRpc, method: string, payload: unknown, schema: z.ZodType<T>, signal: AbortSignal) {
  const result = await rpc.call(CHANNEL, method, payload, signal);
  if (!result.ok) throw new Error(result.error.message);
  return schema.parse(result.value);
}

function isolatedHtml({ html, csp }: z.infer<typeof appResource>): string {
  const media = ["data:", "blob:", ...csp.resourceDomains].join(" ");
  const policy = [
    "default-src 'none'", "base-uri 'none'", "form-action 'none'",
    "script-src 'unsafe-inline'", "style-src 'unsafe-inline'",
    `img-src ${media}`, `media-src ${media}`,
    `connect-src ${csp.connectDomains.join(" ") || "'none'"}`,
  ].join("; ");
  return html.replace(/<head>/i, `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`);
}

function ScraperFrame({ rpc, t, path }: PanelProps & { path: AppPath }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const iframe = frame.current;
    if (!iframe?.contentWindow) return;
    const target = iframe.contentWindow;
    const controller = new AbortController();
    const { signal } = controller;
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    let bridge: AppBridge | undefined;
    let resize: ResizeObserver | undefined;
    setError(undefined);
    setLoading(true);
    const fail = (cause: unknown) => {
      if (signal.aborted) return;
      controller.abort();
      void bridge?.close().catch(() => undefined);
      setError(cause instanceof Error ? cause.message : String(cause));
      setLoading(false);
    };
    const timer = setTimeout(() => fail(new Error(t("failed"))), 20_000);
    const hostContext = () => {
      const colorScheme = getComputedStyle(document.documentElement).colorScheme;
      const theme = colorScheme === "dark" || (colorScheme !== "light" && scheme.matches) ? "dark" : "light";
      iframe.style.colorScheme = theme;
      return {
        theme,
        containerDimensions: { width: iframe.clientWidth, height: iframe.clientHeight },
      } as const;
    };
    const updateHost = () => { if (!signal.aborted) bridge?.setHostContext(hostContext()); };

    const load = async () => {
      const resource = await request(rpc, RESOURCE, path, appResource, signal);
      signal.throwIfAborted();
      const view = new AppBridge(null, { name: "DeepSeek Harness", version: "0.2.1-rc.2" }, {
        openLinks: {},
      }, {
        hostContext: {
          ...hostContext(), platform: "web", displayMode: "inline", availableDisplayModes: ["inline"],
          toolInfo: { tool: resource.tool }, scraperManualLogin: true,
        },
      });
      bridge = view;
      view.oncalltool = (params, extra) => request(
        rpc, CALL_TOOL, params, callToolResult, AbortSignal.any([signal, extra.mcpReq.signal]),
      );
      view.onopenlink = async ({ url }) => {
        const targetUrl = new URL(url);
        if (!["http:", "https:"].includes(targetUrl.protocol) || targetUrl.username || targetUrl.password) {
          throw new Error("Unsupported link");
        }
        window.open(targetUrl.href, "_blank", "noopener,noreferrer");
        return {};
      };
      view.oninitialized = () => {
        clearTimeout(timer);
        setLoading(false);
        updateHost();
      };
      // The transport filters by the iframe WindowProxy. Listen before loading srcdoc.
      await view.connect(new PostMessageTransport(target, target));
      signal.throwIfAborted();
      iframe.srcdoc = isolatedHtml(resource);
      resize = new ResizeObserver(updateHost);
      resize.observe(iframe);
      scheme.addEventListener("change", updateHost);
    };
    void load().catch(fail);
    return () => {
      controller.abort();
      clearTimeout(timer);
      resize?.disconnect();
      scheme.removeEventListener("change", updateHost);
      void bridge?.close().catch(() => undefined);
      iframe.removeAttribute("srcdoc");
    };
  }, [rpc, path, attempt, t]);

  return <>
    {loading && <p role="status">{t("loading")}</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setAttempt(attempt + 1)}>{t("retry")}</button></p>}
    <iframe ref={frame} title={t("title")} sandbox="allow-scripts"
      style={{ width: "100%", flex: 1, minHeight: 0, border: 0 }} />
  </>;
}

function ScraperPanel(props: PanelProps) {
  const { t } = props;
  const [path, setPath] = useState<AppPath>("/search_videos");
  return <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
    <div style={{ padding: "8px 12px" }}>
      <select aria-label={t("choosePage")} value={path} onChange={event => setPath(appPath.parse(event.target.value))}>
        <optgroup label={t("douyin")}>
          <option value="/search_videos">{t("videos")}</option>
          <option value="/search_users">{t("users")}</option>
          <option value="/login">{t("login")}</option>
        </optgroup>
        <optgroup label={t("xiaohongshu")}>
          <option value="/xiaohongshu/search_videos">{t("notes")}</option>
          <option value="/xiaohongshu/search_users">{t("users")}</option>
          <option value="/xiaohongshu/login">{t("login")}</option>
        </optgroup>
      </select>
    </div>
    <ScraperFrame key={path} {...props} path={path} />
  </div>;
}

export const inject = ["slots", "locale", "sidebarRightTabs", "connection"];

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register("scraper", { en, zh }));
  const t = ctx.locale.bind("scraper");
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB, kind: "scraper", title: () => t("title"),
    guide: [{ id: TAB, order: 50, title: () => t("title") }],
  }));
  ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
    name: "sidebar.right.pane.tab", key: TAB, locale: "scraper",
    inject: () => ({ rpc: ctx.connection.rpc }),
  }, ScraperPanel)));
}
