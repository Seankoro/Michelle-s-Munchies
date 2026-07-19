import Image from "next/image";

/**
 * Shared branded loading state for admin panel pages while data hydrates.
 * Michelle herself, mid-thought in a speech bubble, so a wait still feels like
 * the shop rather than a bare spinner. She bobs gently, calmed under
 * prefers-reduced-motion by the global rule in globals.css.
 */
export function PanelLoading() {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-24">
      <span className="relative -rotate-1 animate-[pop_0.3s_ease-out] rounded-2xl border-2 border-ink/70 bg-white px-4 py-2.5 text-sm font-semibold text-ink">
        One moment, pulling this fresh from the oven&hellip;
        <span
          aria-hidden="true"
          className="absolute -bottom-[9px] left-1/2 h-3.5 w-3.5 -translate-x-1/2 rotate-45 border-b-2 border-r-2 border-ink/70 bg-white"
        />
      </span>
      <Image src="/logo.png" alt="" width={512} height={512} className="h-16 w-16 animate-float" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
