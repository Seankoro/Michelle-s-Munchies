import { cn } from "@/lib/cn";

type ToggleProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name for the switch, announced by screen readers. */
  label: string;
  disabled?: boolean;
  className?: string;
};

/**
 * Accessible on or off switch with role="switch". Use for boolean settings. For
 * picking from a list or ticking items off, use a real checkbox instead.
 */
export function Toggle({ checked, onChange, label, disabled, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-rose-deep bg-rose-deep" : "border-line bg-marble",
        className,
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
