export type ClassValue = string | number | null | false | undefined;

/**
 * Tiny className joiner, filters out falsy values so we can write
 * conditional classes inline without pulling in a dependency.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
