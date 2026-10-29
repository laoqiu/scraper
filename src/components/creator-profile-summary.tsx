import type { ReactNode } from "react";
import { CircleUserRound, UserRoundCheck } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";

export interface CreatorProfileSummaryProps {
  avatarUrl?: string;
  nickname?: string;
  nameFallback: string;
  meta?: ReactNode;
  loadingDetail?: string;
  authenticated?: boolean;
}

/** Shared avatar, display name, and basic account information block. */
export function CreatorProfileSummary({
  avatarUrl,
  nickname,
  nameFallback,
  meta,
  loadingDetail = "正在获取信息…",
  authenticated = false,
}: CreatorProfileSummaryProps) {
  return <>
    <Avatar className={`creator-profile-avatar ${authenticated ? "authenticated" : "waiting"}`}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt={nickname || nameFallback} />}
      <AvatarFallback>{authenticated ? <UserRoundCheck size={32} /> : <CircleUserRound size={32} />}</AvatarFallback>
    </Avatar>
    <div className="creator-profile-copy">
      <h2>{nickname || nameFallback}</h2>
      {meta ?? <p>{loadingDetail}</p>}
    </div>
  </>;
}
