/**
 * Shown while the menu's data is on its way. Shaped like the real page so
 * nothing jumps when it lands.
 *
 * Worth more than it looks. A dynamic route with no loading boundary gives Next
 * nothing to prefetch when a link scrolls into view, so the first byte only
 * moves on tap and the old page just sits there. With the boundary the skeleton
 * is already cached by the time the finger lands.
 */
export default function MenuLoading() {
  return (
    <main className="mx-auto max-w-none px-6 py-12 lg:px-10">
      <header className="text-center">
        <div className="mx-auto h-10 w-56 animate-pulse rounded-full bg-marble" />
        <div className="mx-auto mt-3 h-4 w-80 max-w-full animate-pulse rounded-full bg-marble" />
      </header>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-9 w-24 animate-pulse rounded-full bg-marble" />
        ))}
      </div>
      <div className="mt-8 grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-line bg-white p-3">
            <div className="aspect-square w-full animate-pulse rounded-xl bg-marble" />
            <div className="mt-3 h-4 w-3/4 animate-pulse rounded-full bg-marble" />
            <div className="mt-2 h-4 w-1/3 animate-pulse rounded-full bg-marble" />
          </div>
        ))}
      </div>
    </main>
  );
}
