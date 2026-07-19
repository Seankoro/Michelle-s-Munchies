import "server-only";
import { fetchProducts } from "@/lib/products";
import { fetchActiveBundles } from "@/lib/bundles";
import { fetchActiveBoxTemplates } from "@/lib/boxes";
import { createAdminClient } from "@/lib/supabase/admin";
import { menuCartKey } from "@/lib/cart-key";
import type { CartItem, Personalisation, Product, SelectedOption } from "@/lib/types";

export type RawSelection = { optionName?: string; valueLabel: string };
export type RawCartLine = {
  productId: string | null;
  /** Name fallback when matching by id fails, since order snapshots keep the name. */
  productName?: string | null;
  quantity: number;
  selections: RawSelection[];
  /** Carried through unchanged so a personalised line keeps its message and photo. */
  personalisation?: Personalisation;
};

/**
 * A line that couldn't be re-added automatically, plus a deep link to re-add it
 * by hand where we can point at one page: a bundle, a build-a-box template, or a
 * product's own page (sold out or its options changed). `href` is absent only
 * when there is no single page to send the customer to.
 */
export type SkippedLine = { name: string; href?: string };

/**
 * Re-resolve "raw" cart lines against the current catalog, with live price and
 * availability, options matched by label, and the cart key built like
 * OptionPicker so lines merge with menu adds. Lines whose product is gone or
 * sold-out, or whose required options no longer exist, are reported in `skipped`
 * by name, with a deep link to re-add them where one exists.
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
        : option.required
          ? option.values[0]
          : undefined;
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
      // Product still sold, but a required option is gone; point at its page.
      skipped.push({ name: product.name, href: menuHref(product) });
      continue;
    }

    // Always `id::values` (empty values → `id::`), exactly how OptionPicker keys
    // a menu add, so a reordered or shared line merges with the same item added
    // from the menu instead of becoming a second row.
    const key = menuCartKey(product.id, valueIds);
    const unitPriceCents =
      product.basePriceCents + selectedOptions.reduce((sum, o) => sum + o.priceDeltaCents, 0);

    items.push({
      key,
      productId: product.id,
      slug: product.slug,
      name: product.name,
      unitPriceCents,
      quantity: line.quantity,
      selectedOptions,
      ...(line.personalisation ? { personalisation: line.personalisation } : {}),
    });
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
