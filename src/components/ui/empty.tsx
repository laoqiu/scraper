import type { HTMLAttributes, ReactNode } from "react";

const cn = (...values: Array<string | undefined | false>) => values.filter(Boolean).join(" ");

export function Empty({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn("ui-empty", className)} {...props} />;
}

export function EmptyMedia({ className, children, variant, ...props }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode; variant?: "icon" | "default" }) {
  return <div className={cn("ui-empty-media", className)} {...props}>{children}</div>;
}

export function EmptyHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ui-empty-header", className)} {...props} />;
}

export function EmptyTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("ui-empty-title", className)} {...props} />;
}

export function EmptyDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("ui-empty-description", className)} {...props} />;
}
