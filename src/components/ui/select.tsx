import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

const cn = (...values: Array<string | undefined | false>) => values.filter(Boolean).join(" ");

export interface SelectOption {
  value: string;
  label: ReactNode;
}

export interface SelectProps {
  value: string;
  options: readonly SelectOption[];
  onValueChange: (value: string) => void;
  placeholder?: ReactNode;
  className?: string;
  disabled?: boolean;
}

export function Select({ value, options, onValueChange, placeholder, className, disabled }: SelectProps) {
  return <SelectPrimitive.Root
    value={value}
    onValueChange={(next) => {
      if (next !== null) onValueChange(String(next));
    }}
    items={options}
    disabled={disabled}
  >
    <SelectPrimitive.Trigger className={cn("ui-select-trigger", className)}>
      <SelectPrimitive.Value placeholder={placeholder} />
      <SelectPrimitive.Icon className="ui-select-icon"><ChevronDown size={16} /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner sideOffset={4} className="ui-select-positioner">
        <SelectPrimitive.Popup className="ui-select-popup">
          <SelectPrimitive.List>
            {options.map((option) => <SelectPrimitive.Item className="ui-select-item" key={option.value} value={option.value}>
              <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              <SelectPrimitive.ItemIndicator className="ui-select-item-indicator"><Check size={14} /></SelectPrimitive.ItemIndicator>
            </SelectPrimitive.Item>)}
          </SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>;
}
