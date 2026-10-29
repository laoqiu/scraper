import { Check } from "lucide-react";
import type { InputHTMLAttributes } from "react";

export function Checkbox({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <label className={`ui-checkbox ${className}`}>
    <input {...props} type="checkbox" />
    <span className="ui-checkbox-mark" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>
  </label>;
}
