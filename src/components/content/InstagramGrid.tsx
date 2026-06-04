import { fetchActiveInstagramPosts } from "@/lib/instagram";

/**
 * Curated Instagram grid that Michelle fills by hand, pasting image and post
 * links. Uses plain <img> and <a> tags only, with no Meta embed script, so the
 * CSP stays tight. Renders nothing when there are no active posts. The caller
 * gates on the `instagram` flag.
 */
export async function InstagramGrid() {
  const posts = await fetchActiveInstagramPosts();
  if (posts.length === 0) return null;

  return (
    <section className="mx-auto max-w-none px-6 py-12 lg:px-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-2xl font-semibold">From our kitchen 📸</h2>
        <a
          href="https://instagram.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-rose transition hover:text-rose-deep"
        >
          Follow us →
        </a>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {posts.map((post) => (
          <a
            key={post.id}
            href={post.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative aspect-square overflow-hidden rounded-2xl"
            title={post.caption ?? "View on Instagram"}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={post.imageUrl}
              alt={post.caption ?? "Instagram post"}
              className="h-full w-full object-cover transition group-hover:scale-105"
            />
          </a>
        ))}
      </div>
    </section>
  );
}
