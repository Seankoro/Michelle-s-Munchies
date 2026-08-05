import "server-only";
import { fetchProducts } from "@/lib/products";
import { fetchActiveBundles } from "@/lib/bundles";
import { fetchActiveBoxTemplates } from "@/lib/boxes";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchCommittedUnits } from "@/lib/stock-availability";
import { menuCartKey } from "@/lib/cart-key";
import type { CartItem, Personalisation, Product, SelectedOption } from "@/lib/types";

export type RawSelection = { optionName?: string; valueLabel: string };
export type RawCartLine = {
  productId: string | null;
  /** Name fallback when matching by id fails, since order snapshots keep the name. */
  productName?: string | null;
  quantity: number;
  selections: RawSelection[];
  /** Kept, capped, and checked against the product so a personalised line keeps
   *  its message and photo without becoming a free-text channel to Michelle. */
  personalisation?: Personalisation;
};

/**
 * A line that couldn't be re-added automatically, plus a deep link to re-add it
 * by hand where we can point at one page: a bundle, a build-a-box template, or a
 * product's own page (sold out or its options changed). `href` is absent only
 * when there is no single page to send the customer to.
 */
export type SkippedLine = { name: string; href?: string };

/** Longest personalisation message we keep, the same cap the form applies. */
const MAX_PERSONALISATION_LENGTH = 120;
/** A real upload is `{productId}/{uuid}.{ext}`, so require exactly that shape. */
const UPLOADED_FILE_RE = /^[a-z0-9-]+\.[a-z0-9]+$/i;

/**
 * Keep a line's personalisation only where the product actually offers it. The
 * cart is client state and checkout is a public action, so an edited or forged
 * line could otherwise pin a piping instruction on a treat Michelle never
 * personalises, print a wall of text across her packing slip, or point the
 * "reference photo" link in her admin panel at someone else's site. These are
 * the same checks the upload action makes, so both ends agree on what counts.
 */
function sanitizePersonalisation(
  product: Product,
  raw: Personalisation | undefined,
): Personalisation | undefined {
  if (!raw || !product.personalisation) return undefined;
  const message = (raw.message ?? "").trim().slice(0, MAX_PERSONALISATION_LENGTH);
  const photo = raw.photoUrl ?? "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  // The photo must be an upload sitting in this product's own folder of our
  // public bucket. Matching the file name too rejects path traversal like
  // `.../<id>/../../avatars/x.png`, which a bare startsWith would let through.
  const prefix = `${supabaseUrl}/storage/v1/object/public/personalisation-images/${product.id}/`;
  const keepPhoto =
    Boolean(supabaseUrl) &&
    product.personalisation.allowPhoto &&
    photo.startsWith(prefix) &&
    UPLOADED_FILE_RE.test(photo.slice(prefix.length));
  if (!message && !keepPhoto) return undefined;
  return {
    ...(message ? { message } : {}),
    ...(keepPhoto ? { photoUrl: photo } : {}),
  };
}

/**
 * Re-resolve "raw" cart lines against the current catalog, with live price and
 * availability, options matched by label, and the cart key built like
 * OptionPicker so lines merge with menu adds. Lines whose product is gone,
 * sold-out, short on tracked stock, or whose chosen or required options no
 * longer exist, are reported in `skipped` by name, with a deep link to re-add
 * them where one exists.
 *
 * Shared by "Order again" in buildReorderCart and shared-cart links in
 * resolveSharedCart so the resolution logic lives in one place.
 */
export async function resolveCartLines(
  lines: RawCartLine[],
): Promise<{ items: CartItem[]; skipped: SkippedLine[] }> {
  const products = await fetchProducts();
  const items: CartItem[] = [];
  const skipped: SkippedLine[] = [];
  // Indices of skipped entries whose link still needs a by-name lookup below.
  const needsLink: number[] = [];

  // Units already promised to other customers on orders that have not been paid
  // yet. stock_count only drops when Michelle marks a PayNow transfer paid, days
  // later, so without this the same batch is sold over and over to everyone who
  // orders in between. One query for the whole cart.
  const trackedIds = products.filter((p) => p.stockCount != null).map((p) => p.id);
  const committed = await fetchCommittedUnits(trackedIds);

  // Units this same cart has already taken, built up as we walk its lines. One
  // cart can hold a treat on two lines, either with different options or as a
  // plain duplicate, and each line is checked on its own, so without this the
  // last batch is sold twice inside a single checkout. Only counted once a line
  // is really kept, so a line dropped over its options frees what it never took.
  const claimed = new Map<string, number>();

  // Bundles, build-a-box, and pick-your-flavours lines use a prefixed, non-uuid
  // id (bundle:/box:/fbox: or a "::" composite). Their full contents can't be
  // rebuilt from an order snapshot or a share link, so name them for re-adding
  // rather than mislabel a real, available bundle as "unavailable".
  const isSpecialLine = (id: string) => /^(bundle|box|fbox):/.test(id) || id.includes("::");
  const menuHref = (p: Product) => `/menu/${p.slug}`;

  // A precise link for a prefixed special line, straight from the id we hold.
  function specialHref(id: string): string | undefined {
    if (id.startsWith("bundle:")) return `/bundles/${id.slice("bundle:".length)}`;
    if (id.startsWith("box:")) return `/build-a-box/${id.slice("box:".length)}`;
    if (id.startsWith("fbox:")) {
      const p = products.find((x) => x.id === id.slice("fbox:".length));
      return p ? menuHref(p) : undefined;
    }
    return undefined; // "::" composite: no single page to point at
  }

  function pushSkipped(name: string, href?: string) {
    skipped.push({ name, href });
    if (!href) needsLink.push(skipped.length - 1);
  }

  for (const line of lines) {
    if (line.productId && isSpecialLine(line.productId)) {
      pushSkipped(line.productName ?? "a bundle or build-a-box treat", specialHref(line.productId));
      continue;
    }
    const product =
      (line.productId ? products.find((p) => p.id === line.productId) : undefined) ??
      (line.productName ? products.find((p) => p.name === line.productName) : undefined);
    if (!product || !product.isAvailable) {
      // A found-but-sold-out product links to its own page (browse / waitlist);
      // an unfound name is matched against bundles and boxes after the loop.
      if (product) skipped.push({ name: product.name, href: menuHref(product) });
      else pushSkipped(line.productName ?? "an unavailable item");
      continue;
    }
    // A tracked treat can only be sold down to what is genuinely uncommitted:
    // what is on the shelf, minus what other unpaid orders have already promised
    // away, minus what the earlier lines of this cart have taken. Counting only
    // the shelf let several unpaid PayNow orders each be sold the same batch,
    // and ignoring the cart's own lines let one order do it on its own.
    // Untracked stock stays unlimited.
    if (product.stockCount != null) {
      const uncommitted =
        product.stockCount - (committed.get(product.id) ?? 0) - (claimed.get(product.id) ?? 0);
      if (line.quantity > uncommitted) {
        skipped.push({ name: product.name, href: menuHref(product) });
        continue;
      }
    }

    const selectedOptions: SelectedOption[] = [];
    const valueIds: string[] = [];
    let mismatch = false;
    for (const option of product.options) {
      // Match a chosen value by option name first, else by a label this option offers.
      const chosen =
        line.selections.find((s) => s.optionName === option.name) ??
        line.selections.find((s) => option.values.some((v) => v.label === s.valueLabel));
      const value = chosen
        ? option.values.find((v) => v.label === chosen.valueLabel)
        : undefined;
      // A value Michelle has unticked counts as gone, and so does one she has
      // renamed or deleted, which is why a chosen label we can no longer find is
      // treated the same way. The line lands in `skipped` with a link to its
      // page, rather than reaching the bake list as a flavour she ran out of.
      // Quietly swapping in another value would check a 6 inch cake out as a 4
      // inch one, at the 4 inch price, so the customer picks again instead.
      if (chosen && (!value || value.isAvailable === false)) {
        mismatch = true;
        break;
      }
      // Nothing chosen at all for a required option, which is how an order
      // placed before Michelle added that option reads, needs a real pick too.
      // An optional option nobody chose is left off the line as before.
      if (option.required && !value) {
        mismatch = true;
        break;
      }
      if (value) {
        selectedOptions.push({
          optionName: option.name,
          valueLabel: value.label,
          priceDeltaCents: value.priceDeltaCents,
        });
        valueIds.push(value.id);
      }
    }
    if (mismatch) {
      // Product still sold, but a chosen value sold out or is no longer offered,
      // or a required option has no pick. Point at its page so they choose again.
      skipped.push({ name: product.name, href: menuHref(product) });
      continue;
    }

    // Always `id::values` (empty values → `id::`), exactly how OptionPicker keys
    // a menu add, so a reordered or shared line merges with the same item added
    // from the menu instead of becoming a second row.
    const key = menuCartKey(product.id, valueIds);
    const unitPriceCents =
      product.basePriceCents + selectedOptions.reduce((sum, o) => sum + o.priceDeltaCents, 0);

    const personalisation = sanitizePersonalisation(product, line.personalisation);

    items.push({
      key,
      productId: product.id,
      slug: product.slug,
      name: product.name,
      unitPriceCents,
      quantity: line.quantity,
      selectedOptions,
      ...(personalisation ? { personalisation } : {}),
    });
    // Count the units now that the line is really in the cart, so a later line
    // of the same treat is measured against what this one already took.
    claimed.set(product.id, (claimed.get(product.id) ?? 0) + line.quantity);
  }

  // A reordered bundle/box line stores only its name (product_id is null on the
  // order), so match those names against active bundles and box templates for a
  // deep link. Loaded lazily, so a clean checkout that skips nothing never pays.
  if (needsLink.length > 0) {
    const [bundles, boxes] = await Promise.all([fetchActiveBundles(), fetchActiveBoxTemplates()]);
    const linkByName = new Map<string, string>();
    for (const p of products) linkByName.set(p.name.toLowerCase(), menuHref(p));
    for (const b of bundles) linkByName.set(b.name.toLowerCase(), `/bundles/${b.slug}`);
    for (const b of boxes) linkByName.set(b.name.toLowerCase(), `/build-a-box/${b.slug}`);
    for (const i of needsLink) {
      const href = linkByName.get(skipped[i].name.toLowerCase());
      if (href) skipped[i] = { ...skipped[i], href };
    }
  }

  return { items, skipped };
}

/** One stored order line, as read back from order_items for a reorder. */
type ReorderItemRow = {
  product_id: string | null;
  product_name: string;
  quantity: number;
  selected_options: SelectedOption[] | null;
};

export type ReorderResult =
  | { ok: true; items: CartItem[]; skipped: SkippedLine[] }
  | { ok: false; error: string; skipped?: SkippedLine[] };

/**
 * Rebuild a cart from a placed order's items, re-priced against the live
 * catalogue. Shared by "Order again" from the account and from the tracking
 * token, which differ only in how they authorise and find the order id.
 */
export async function reorderFromOrderId(orderId: string): Promise<ReorderResult> {
  const admin = createAdminClient();
  const { data: itemRows } = await admin
    .from("order_items")
    .select("product_id, product_name, quantity, selected_options")
    .eq("order_id", orderId);
  const rows = (itemRows as ReorderItemRow[] | null) ?? [];

  const { items, skipped } = await resolveCartLines(
    rows.map((row) => ({
      productId: row.product_id,
      productName: row.product_name,
      quantity: row.quantity,
      selections: (row.selected_options ?? []).map((o) => ({
        optionName: o.optionName,
        valueLabel: o.valueLabel,
      })),
    })),
  );
  if (items.length === 0) {
    return {
      ok: false,
      error: "None of these items are available to reorder right now.",
      skipped,
    };
  }
  return { ok: true, items, skipped };
}
