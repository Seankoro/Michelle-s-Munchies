import Image from "next/image";
import { fetchActiveInstagramPosts } from "@/lib/instagram";

/**
 * Curated Instagram grid that Michelle fills by hand, pasting image and post
 * links. Uses plain <a> tags with no Meta embed script, so the
 * CSP stays tight. Renders nothing when there are no active posts. The caller
 * gates on the `instagram` flag.
 */
export async function InstagramGrid() {
  const posts = await fetchActiveInstagramPosts();
  if (posts.length === 0) return null;

  // Real profile link only when the handle is configured, a generic
  // instagram.com link reads as a placeholder.
  const handle = (process.env.INSTAGRAM_HANDLE ?? "").replace(/^@/, "");

  return (
    <section className="mx-auto max-w-none px-6 py-12 lg:px-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-2xl font-semibold">From our kitchen 📸</h2>
        {handle && (
          <a
            href={`https://instagram.com/${handle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-rose-ink transition hover:text-rose"
          >
            Follow us →
          </a>
        )}
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
            {/* next/image so the phone gets a thumbnail rather than the full
                upload. These sit near the bottom of the home page, so they load
                lazily and cost nothing until someone scrolls to them. */}
            <Image
              src={post.imageUrl}
              alt={post.caption ?? "Instagram post"}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
              className="object-cover transition group-hover:scale-105"
            />
          </a>
        ))}
      </div>
    </section>
  );
}
