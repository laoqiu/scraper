import type { InputHTMLAttributes } from "react";

const cn = (...values: Array<string | undefined | false>) => values.filter(Boolean).join(" ");

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("ui-input", className)} {...props} />;
}
