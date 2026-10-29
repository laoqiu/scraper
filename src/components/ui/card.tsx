import type { HTMLAttributes } from "react";

const cn = (...values: Array<string | undefined | false>) => values.filter(Boolean).join(" ");

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ui-card", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ui-card-content", className)} {...props} />;
}
