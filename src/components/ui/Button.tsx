import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-rose-deep text-white shadow-soft hover:-translate-y-0.5 hover:brightness-110",
  secondary: "border border-line bg-white text-ink hover:border-rose",
  ghost: "text-ink hover:bg-blush-soft",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-4 py-2 text-sm",
  md: "px-6 py-2.5",
  lg: "px-7 py-3 text-lg",
};

/**
 * Shared button styling. Exported separately so it can be applied to non-button
 * elements too (e.g. a Next.js <Link> styled as a button).
 */
export function buttonClasses(opts?: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}): string {
  const { variant = "primary", size = "md", className } = opts ?? {};
  return cn(base, variantClasses[variant], sizeClasses[size], className);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={buttonClasses({ variant, size, className })} {...props} />
  );
}
