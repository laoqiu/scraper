import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { useEffect, useState } from "react";
import { CreatorProfileSummary } from "../components/creator-profile-summary";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import type { LoginState, PlatformId } from "../server/types";
import { errorText, PageHeader, structured } from "./shared";

export function LoginPage({ app, initialResult, platform = "douyin" }: { app: App; initialResult: CallToolResult | null; platform?: PlatformId }) {
  const initial = structured<{ login?: LoginState }>(initialResult)?.login;
  const [login, setLogin] = useState<LoginState | undefined>(initial);
  const [busy, setBusy] = useState(!initialResult);
  const [error, setError] = useState<string | undefined>(initialResult ? errorText(initialResult) : undefined);
  const [success, setSuccess] = useState<string>();
  const [xiaohongshuProfile, setXiaohongshuProfile] = useState<{ nickname?: string; redId?: string; avatarUrl?: string; signature?: string }>();

  useEffect(() => {
    if (!initialResult) return;
    setBusy(false);
    setError(errorText(initialResult));
    const next = structured<{ login?: LoginState }>(initialResult)?.login;
    if (next) setLogin(next);
    const profile = structured<{ profile?: { nickname?: string; redId?: string; avatarUrl?: string; signature?: string } }>(initialResult)?.profile;
    if (profile) setXiaohongshuProfile(profile);
  }, [initialResult]);

  const reopen = async () => {
    setBusy(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      const result = await app.callServerTool({ name: platform === "xiaohongshu" ? "xiaohongshu.get_cookie" : "douyin.get_cookie", arguments: {} });
      const message = errorText(result);
      const next = structured<{ login?: LoginState }>(result)?.login;
      setError(message);
      if (next) {
        setLogin(next);
        if (!message && next.account) {
          const text = [
            "用户登录成功",
            "",
            `昵称：${next.account.nickname || "-"}`,
            `关注：${next.account.followingCount}`,
            `粉丝：${next.account.followerCount}`,
          ].join("\n");
          await app.updateModelContext({ content: [{ type: "text", text }], structuredContent: { douyinAccount: next.account } });
          await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
        }
      }
      const profile = structured<{ profile?: { nickname?: string; redId?: string; avatarUrl?: string; signature?: string } }>(result)?.profile;
      if (profile) setXiaohongshuProfile(profile);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const status = login?.status ?? (xiaohongshuProfile ? "authenticated" : "waiting");
  const account = status === "authenticated" ? login?.account : undefined;
  const profile = platform === "xiaohongshu" ? xiaohongshuProfile : undefined;
  const statusTitle = status === "authenticated" ? "账号已连接" : error || status === "error" ? "登录未完成" : "等待登录";
  const detail = error || success || (login?.account
    ? `${login.account.nickname || "抖音用户"} · 抖音号 ${login.account.douyinId || "-"}`
    : profile ? `${profile.nickname || "小红书用户"} · 小红书号 ${profile.redId || "-"}` : login?.message || `请在浏览器中完成${platform === "xiaohongshu" ? "小红书" : "抖音"}登录，最长等待 5 分钟。`);

  return <main className="page">
    <PageHeader eyebrow={platform === "xiaohongshu" ? "XIAOHONGSHU" : "DOUYIN"} title={`连接${platform === "xiaohongshu" ? "小红书" : "抖音"}账号`} description="登录成功后会保存当前会话，后续采集自动复用。" />
    <Card className="login-panel">
      <CreatorProfileSummary
        avatarUrl={account?.avatarUrl ?? profile?.avatarUrl}
        nickname={account?.nickname ?? profile?.nickname}
        nameFallback={statusTitle}
        loadingDetail={detail}
        authenticated={status === "authenticated"}
        meta={account ? <div className="creator-profile-meta"><span>关注 {account.followingCount}</span><span>| 粉丝 {account.followerCount}</span></div> : undefined}
      />
      <Button className="primary login-action" disabled={busy} onClick={() => void reopen()}>{busy ? "等待登录…" : "重新打开登录"}</Button>
    </Card>
  </main>;
}
