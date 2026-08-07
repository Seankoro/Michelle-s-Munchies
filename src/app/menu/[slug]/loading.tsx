/** Product detail skeleton, in the two-column shape the real page uses. */
export default function ProductLoading() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <div className="h-4 w-32 animate-pulse rounded-full bg-marble" />
      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <div className="aspect-square w-full animate-pulse rounded-2xl bg-marble" />
        <div>
          <div className="h-9 w-2/3 animate-pulse rounded-full bg-marble" />
          <div className="mt-3 h-5 w-24 animate-pulse rounded-full bg-marble" />
          <div className="mt-6 h-4 w-full animate-pulse rounded-full bg-marble" />
          <div className="mt-2 h-4 w-5/6 animate-pulse rounded-full bg-marble" />
          <div className="mt-8 h-12 w-full animate-pulse rounded-full bg-marble" />
        </div>
      </div>
    </main>
  );
}
