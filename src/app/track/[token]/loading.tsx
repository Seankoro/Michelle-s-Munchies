/**
 * Order tracking skeleton. This one is opened straight from an email on a
 * phone, often on mobile data, so the wait is the most visible on the site.
 */
export default function TrackLoading() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="text-center">
        <div className="mx-auto h-24 w-24 animate-pulse rounded-full bg-marble" />
        <div className="mx-auto mt-6 h-9 w-64 max-w-full animate-pulse rounded-full bg-marble" />
        <div className="mx-auto mt-3 h-4 w-48 animate-pulse rounded-full bg-marble" />
      </div>
      <div className="mt-10 rounded-2xl border border-line bg-white p-6">
        <div className="h-5 w-32 animate-pulse rounded-full bg-marble" />
        <div className="mt-4 flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-4 w-full animate-pulse rounded-full bg-marble" />
          ))}
        </div>
      </div>
    </main>
  );
}
