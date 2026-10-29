import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";

const cn = (...values: Array<string | undefined | false>) => values.filter(Boolean).join(" ");

export function Avatar({ className, ...props }: AvatarPrimitive.Root.Props) {
  return <AvatarPrimitive.Root className={cn("ui-avatar", typeof className === "string" ? className : undefined)} {...props} />;
}

export function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return <AvatarPrimitive.Image className={cn("ui-avatar-image", typeof className === "string" ? className : undefined)} {...props} />;
}

export function AvatarFallback({ className, ...props }: AvatarPrimitive.Fallback.Props) {
  return <AvatarPrimitive.Fallback className={cn("ui-avatar-fallback", typeof className === "string" ? className : undefined)} {...props} />;
}
