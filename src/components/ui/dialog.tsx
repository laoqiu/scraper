import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";

const cn = (...values: Array<string | undefined | false>) => values.filter(Boolean).join(" ");

export function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root {...props} />;
}

export function DialogContent({ className, children, ...props }: DialogPrimitive.Popup.Props) {
  return <DialogPrimitive.Portal>
    <DialogPrimitive.Backdrop className="ui-dialog-overlay" />
    <DialogPrimitive.Viewport className="ui-dialog-viewport">
      <DialogPrimitive.Popup className={cn("ui-dialog-content", typeof className === "string" ? className : undefined)} {...props}>
        {children}
        <DialogPrimitive.Close className="ui-dialog-close" aria-label="关闭">
          <X size={17} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Viewport>
  </DialogPrimitive.Portal>;
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("ui-dialog-header", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("ui-dialog-footer", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title className={cn("ui-dialog-title", typeof className === "string" ? className : undefined)} {...props} />;
}

export function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return <DialogPrimitive.Description className={cn("ui-dialog-description", typeof className === "string" ? className : undefined)} {...props} />;
}
