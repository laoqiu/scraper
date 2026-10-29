import { Button as ButtonPrimitive } from "@base-ui/react/button";

const cn = (...values: Array<string | undefined | false>) => values.filter(Boolean).join(" ");

type ButtonVariant = "default" | "secondary";

export function Button({
  className,
  variant = "default",
  type = "button",
  ...props
}: ButtonPrimitive.Props & { variant?: ButtonVariant }) {
  return <ButtonPrimitive
    type={type}
    className={cn("app-button", variant === "secondary" && "app-button-secondary", typeof className === "string" ? className : undefined)}
    {...props}
  />;
}
