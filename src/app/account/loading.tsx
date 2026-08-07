/** Account skeleton. One panel is enough, the page is a stack of them. */
export default function AccountLoading() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="h-9 w-48 animate-pulse rounded-full bg-marble" />
      <div className="mt-8 flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-line bg-white p-6">
            <div className="h-5 w-40 animate-pulse rounded-full bg-marble" />
            <div className="mt-3 h-4 w-full animate-pulse rounded-full bg-marble" />
            <div className="mt-2 h-4 w-2/3 animate-pulse rounded-full bg-marble" />
          </div>
        ))}
      </div>
    </main>
  );
}
