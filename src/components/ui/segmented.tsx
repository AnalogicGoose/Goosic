import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";

import { INTERACTIVE_GLASS_CONTROL_CLASS } from "@/components/ui/glass-surface";
import { cn } from "@/lib/utils";

const SPRING = {
  type: "spring" as const,
  duration: 0.25,
  bounce: 0.05,
};

export interface SegmentedOption<T extends string> {
  value: T;
  /** Plain text in the common case; a node when a segment needs an icon
   *  (e.g. a spinner while its count is still being computed). */
  label: React.ReactNode;
}

/**
 * Segmented value picker for settings rows. Sized and shaped to match the
 * adjacent buttons: the outer track carries the same glass material as the
 * `outline` button (`h-8`, `rounded-md`), and the selected segment is a raised
 * chip that reads like a pressed button. The track used a flat
 * `border` + `bg-background` frame, which stood out as the one control in a
 * settings row that was not made of glass.
 * Radio semantics — it picks a value, it doesn't switch panels.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  disabled,
  fullWidth,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentedOption<T>[];
  disabled?: boolean;
  /** Stretch across the container, options sharing the width evenly. */
  fullWidth?: boolean;
  className?: string;
}) {
  const shouldReduceMotion = useReducedMotion();
  const layoutId = useId();

  return (
    <div
      role="radiogroup"
      className={cn(
        INTERACTIVE_GLASS_CONTROL_CLASS,
        "glass-button inline-flex h-8 shrink-0 items-center rounded-md p-0.5",
        fullWidth && "flex w-full",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative flex h-full items-center justify-center rounded-sm px-3 text-sm font-medium whitespace-nowrap transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              fullWidth && "flex-1",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layout
                layoutId={layoutId}
                className="absolute inset-0 rounded-sm bg-accent"
                transition={shouldReduceMotion ? { duration: 0 } : SPRING}
              />
            )}
            <span className="relative z-10">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
