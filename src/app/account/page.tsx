import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { fetchProducts } from "@/lib/products";
import { fetchStoreSettings } from "@/lib/settings";
import { formatPrice } from "@/lib/catalog";
import { ProductCard } from "@/components/product/ProductCard";
import { formatLongDate, type OrderStatus, type PaymentStatus } from "@/lib/order";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/StatusBadge";
import { RibbonDivider } from "@/components/ui/RibbonDivider";
import { SignOutButton } from "@/components/account/SignOutButton";
import { ProfileForm } from "@/components/account/ProfileForm";
import { SavedAddresses } from "@/components/account/SavedAddresses";
import { ReorderButton } from "@/components/account/ReorderButton";
import { ReferralCard } from "@/components/account/ReferralCard";
import { ShareWishlistButton } from "@/components/account/ShareWishlistButton";

export const metadata: Metadata = { title: "Your account" };

function rewardReasonLabel(reason: string): string {
  switch (reason) {
    case "earned":
      return "Earned";
    case "redeemed":
      return "Redeemed";
    case "referral_referrer":
      return "Referral bonus";
    case "referral_referee":
      return "Welcome bonus";
    case "birthday":
      return "Birthday treat";
    default:
      return "Adjustment";
  }
}

type OrderRow = {
  order_number: string;
  tracking_token: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  total_cents: number;
  scheduled_date: string;
  created_at: string;
};

export default async function AccountPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/account/sign-in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone, referral_code, birthday, dietary_prefs")
    .eq("id", user.id)
    .single();
  const referralCode = (profile as { referral_code: string | null } | null)?.referral_code ?? null;

  const { data: orderData } = await supabase
    .from("orders")
    .select("order_number, tracking_token, status, payment_status, total_cents, scheduled_date, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  const orders = (orderData as OrderRow[] | null) ?? [];

  const { data: ledgerData } = await supabase
    .from("points_ledger")
    .select("delta, reason, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  const ledger =
    (ledgerData as { delta: number; reason: string; created_at: string }[] | null) ?? [];
  const pointsBalance = ledger.reduce((sum, entry) => sum + entry.delta, 0);

  const { data: settingsRow } = await supabase
    .from("settings")
    .select(
      "point_value_cents, points_per_dollar, referral_referrer_points, referral_referee_points",
    )
    .eq("id", 1)
    .single();
  const rewardSettings = settingsRow as
    | {
        point_value_cents: number;
        points_per_dollar: number;
        referral_referrer_points: number;
        referral_referee_points: number;
      }
    | null;
  const pointValueCents = rewardSettings?.point_value_cents ?? 5;
  const pointsPerDollar = rewardSettings?.points_per_dollar ?? 1;
  const referrerPoints = rewardSettings?.referral_referrer_points ?? 50;
  const refereePoints = rewardSettings?.referral_referee_points ?? 30;

  const { data: wishlistRows } = await supabase
    .from("wishlists")
    .select("product_id")
    .eq("user_id", user.id);
  const favIds = new Set(
    ((wishlistRows as { product_id: string }[] | null) ?? []).map((w) => w.product_id),
  );
  const favourites = favIds.size > 0 ? (await fetchProducts()).filter((p) => favIds.has(p.id)) : [];

  const firstName = (profile?.full_name ?? "").split(" ")[0] || "there";
  const features = (await fetchStoreSettings()).features;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-4xl font-semibold">Hi, {firstName}!</h1>
        <SignOutButton />
      </div>

      {/* Rewards */}
      {features.rewards && (
      <div className="mt-6 rounded-2xl bg-blush-soft/60 p-5">
        <p className="text-sm font-semibold text-rose-deep">🏆 Rewards</p>
        <p className="mt-1 font-display text-3xl font-semibold text-rose-deep">
          {pointsBalance} {pointsBalance === 1 ? "point" : "points"}
        </p>
        <p className="text-sm text-rose-deep">
          worth {formatPrice(pointsBalance * pointValueCents)} off a future order · earn{" "}
          {pointsPerDollar} {pointsPerDollar === 1 ? "point" : "points"} per S$1 spent
        </p>
        {ledger.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-sm text-rose-deep/90">
            {ledger.slice(0, 5).map((entry, index) => (
              <li key={index} className="flex justify-between">
                <span>{rewardReasonLabel(entry.reason)}</span>
                <span className="font-semibold">
                  {entry.delta > 0 ? `+${entry.delta}` : entry.delta} pts
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}

      {features.referrals && referralCode && (
        <div className="mt-4">
          <ReferralCard
            code={referralCode}
            referrerPoints={referrerPoints}
            refereePoints={refereePoints}
          />
        </div>
      )}

      {features.wishlist && favourites.length > 0 && (
        <>
          <RibbonDivider className="my-8" />
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-2xl font-semibold">Saved treats 🎀</h2>
              {features.wishlistSharing && <ShareWishlistButton />}
            </div>
            <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {favourites.map((favourite) => (
                <ProductCard key={favourite.id} product={favourite} />
              ))}
            </div>
          </section>
        </>
      )}

      <RibbonDivider className="my-8" />

      {/* Order history */}
      <section>
        <h2 className="font-display text-2xl font-semibold">Order history</h2>
        {orders.length === 0 ? (
          <p className="mt-3 text-muted">
            No orders yet.{" "}
            <Link href="/menu" className="font-semibold text-rose hover:text-rose-deep">
              Browse the menu
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {orders.map((order) => (
              <li
                key={order.order_number}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4"
              >
                <div>
                  <p className="font-semibold">{order.order_number}</p>
                  <p className="text-sm text-muted">{formatLongDate(order.scheduled_date)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <OrderStatusBadge status={order.status} />
                  <PaymentStatusBadge status={order.payment_status} />
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold">{formatPrice(order.total_cents)}</span>
                  <Link
                    href={`/track/${order.tracking_token}`}
                    className="text-sm font-semibold text-rose hover:text-rose-deep"
                  >
                    Track →
                  </Link>
                  <ReorderButton orderNumber={order.order_number} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RibbonDivider className="my-8" />

      {/* Profile */}
      <section>
        <h2 className="font-display text-2xl font-semibold">Profile</h2>
        <div className="mt-4">
          <ProfileForm
            email={user.email ?? ""}
            initialName={profile?.full_name ?? ""}
            initialPhone={profile?.phone ?? ""}
            initialBirthday={profile?.birthday ?? ""}
            initialDietaryPrefs={profile?.dietary_prefs ?? []}
          />
        </div>
      </section>

      <RibbonDivider className="my-8" />

      {/* Saved addresses */}
      <section>
        <h2 className="font-display text-2xl font-semibold">Saved addresses</h2>
        <div className="mt-4">
          <SavedAddresses />
        </div>
      </section>
    </main>
  );
}
