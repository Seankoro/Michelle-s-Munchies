import { notFound } from "next/navigation";
import { fetchStoreSettings } from "@/lib/settings";
import { decodeSharedCart } from "@/lib/cart-share";
import { resolveSharedCart } from "@/lib/cart-share-server";
import { LoadSharedCart } from "@/components/cart/LoadSharedCart";

type SearchParams = { searchParams: Promise<{ c?: string }> };

export default async function SharedCartPage({ searchParams }: SearchParams) {
  if (!(await fetchStoreSettings()).features.cartSharing) notFound();
  const { c } = await searchParams;
  const lines = decodeSharedCart(c ?? "");
  if (lines.length === 0) notFound();
  const { items, skipped } = await resolveSharedCart(lines);
  return <LoadSharedCart items={items} skipped={skipped} />;
}
