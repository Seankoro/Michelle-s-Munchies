# Michelle's Munchies — Storefront Enhancements (Design Spec)

**Date:** 2026-06-03
**Status:** Approved design (pending user spec review → writing-plans)
**Scope:** 15 post-launch features across 5 workstreams + cross-cutting toggles, admin
controls, dietary/ingredient expansion, and an OWASP Top 10 (2025) security pass.
**Explicitly excluded** (user decision): recurring/subscription orders; all
Singapore-specific polish (WhatsApp-first, PayNow-as-hero, postal-code delivery zones).

---

## 1. Goals & non-goals

**Goal:** add merchandising, ops, retention, and social-proof features to the existing
(already live) app, each independently switchable so Michelle can adopt them at her own
pace, and each manageable from the admin without code.

**Non-goals:** no payment-provider changes; no courier integration; no subscriptions; no
Meta/Instagram API integration; no dynamic allergen recomputation. Keep money in integer
cents, keep privileged writes in `"use server"` actions on the service-role client, keep
storefront reads on the anon/public client.

## 2. Resolved design decisions (forks)

1. **Abandoned cart → Vercel Cron.** Persist a `checkout_intents` row at email capture; a
   cron-triggered, secret-authed API route emails stale intents once. Owner adds one
   `vercel.json` cron line at deploy.
2. **Instagram → manual curation.** Admin-managed `instagram_posts` (image URL + link +
   caption). No Meta SDK, no tokens, CSP unchanged.
3. **Ingredient substitutions → priced options + note.** Substitutions use the existing
   product-option system with an explanatory note. Allergen/dietary chips remain the
   product's base values; a standing disclaimer sits beside them. **No** live recompute.
4. **Build-a-box → flat box price.** Admin sets one price per box template; customer picks
   exactly `item_count` eligible items for that price.
5. **Back-in-stock ↔ wishlist → linked + guest button.** One `stock_notifications` table
   keyed by `product_id` + `email` (+ optional `user_id`). Favouriting a sold-out item
   auto-subscribes a signed-in user; sold-out products also show a guest email button;
   "Saved treats" flags sold-out favourites.

6. **Sharing → both, separately toggled.** Cart sharing (encoded link, no new table,
   re-resolved server-side) AND wishlist sharing (token-based read-only favourites). Two
   independent feature flags.

**Defaults chosen (override-able):** dietary tags to add = `vegan`, `dairy_free`,
`gluten_free` (NOT Halal — a home kitchen can't be certified; convention stays "No Pork /
No Lard"); photo reviews auto-publish with admin hide/delete.

## 3. Existing foundations this builds on

- **Feature flags:** 6 boolean columns on `settings` → `FeatureFlags` type
  (`src/lib/settings.ts`) → server gating via `fetchStoreSettings().features`; client
  gating via `FeaturesProvider` + `useFeatures()` (seeded in `layout.tsx`). Admin →
  Settings → "Features" checkboxes (`src/app/admin/(panel)/settings/page.tsx`,
  `admin-db.ts`, `AdminStore.tsx`).
- **Product options:** `ProductOption` / `ProductOptionValue` with `priceDeltaCents`
  (`src/lib/types.ts`); cart line `key = productId` or `productId::valueIds.join("|")`.
- **Reviews:** `reviews` table (public read, service-role `upsertReview`), shown on product
  detail (`src/lib/reviews.ts`, `review-actions.ts`).
- **Wishlist:** `wishlists` table (RLS own-row), `FavouriteButton`, account "Saved treats".
- **Emails:** `src/lib/email.ts` best-effort (never throws); order/status/owner mails.
- **Admin auth:** `requireAdmin()` on every admin action (`src/lib/admin-auth.ts`).
- **Rate limiting:** `src/lib/rate-limit.ts` (per-IP, in-memory).
- **Settings authority:** `fetchStoreSettings()` drives checkout fee/lead-time/caps;
  `placeOrder` re-validates server-side; `markOrderPaid` awards points/referrals
  idempotently (unique-index pattern).

## 4. Data model changes

### 4.1 Enums (separate migration, committed before first use)
```
alter type dietary_tag add value if not exists 'vegan';
alter type dietary_tag add value if not exists 'dairy_free';
alter type dietary_tag add value if not exists 'gluten_free';
```
> **Gotcha:** Postgres can't add an enum value and use it in the same transaction. These
> `ADD VALUE` statements go in their own migration, applied before any migration/seed that
> references the new values.

### 4.2 `settings` — new columns
- 11 feature flags (boolean, default per below):
  `feature_build_a_box`, `feature_bundles`, `feature_spend_gift`, `feature_back_in_stock`,
  `feature_photo_reviews`, `feature_cart_sharing`, `feature_wishlist_sharing`,
  `feature_instagram`, `feature_birthday_rewards`, `feature_abandoned_cart`,
  `feature_structured_notes` (all default `true`, matching existing convention).
- `per_window_cap int` null — max non-cancelled orders per (scheduled_date, time_window).
- `daily_cutoff_time time` null — same-day order cutoff (e.g. `18:00`).
- `free_gift_threshold_cents int` null + `free_gift_product_id uuid` null — spend-gift nudge.
- `birthday_reward_points int not null default 0`.
- `abandoned_after_hours int not null default 4`.
- `note_prompts jsonb not null default '[]'` — array of `{ id, label, type: 'text'|'boolean', required }`.

### 4.3 `products` — new column
- `stock_count int` null (null = untracked/unlimited). Optional UI for option-level stock is
  **out of scope** (product-level only).

### 4.4 `profiles` — new columns
- `birthday date` null.
- `birthday_rewarded_year int` null (last calendar year a birthday reward was granted).

### 4.5 `orders` — new column
- `note_answers jsonb not null default '[]'` — answers to the structured note prompts,
  stored as `[{ id, label, answer }]` (the canonical home for structured-note answers; the
  free-text `notes` field is unchanged and kept separate).

### 4.6 `reviews` — new column
- `image_paths text[] not null default '{}'` (public URLs of uploaded review photos).

### 4.7 New tables
- **`bundles`** (`id`, `name`, `slug` unique, `description`, `price_cents`, `image_path`,
  `is_active bool`, `sort_order int`, timestamps). RLS: public read where `is_active`;
  writes service-role only.
- **`bundle_items`** (`id`, `bundle_id` fk, `product_id` fk, `quantity int`). Service-role
  write; read with bundle.
- **`box_templates`** (`id`, `name`, `slug` unique, `item_count int`, `price_cents`,
  `eligible_category text` null, `is_active bool`, `sort_order int`, timestamps). RLS public
  read where `is_active`.
- **`box_template_items`** (`id`, `box_template_id` fk, `product_id` fk) — explicit
  allowlist; if empty, fall back to `eligible_category`.
- **`stock_notifications`** (`id`, `product_id` fk, `email text`, `user_id uuid` null,
  `created_at`, `notified_at` null). Unique `(product_id, lower(email))` to dedupe. RLS:
  no public policies (service-role only); inserts happen through a `"use server"` action.
- **`wishlist_shares`** (`token text` pk — unguessable, `user_id uuid` unique, `created_at`).
  Public read of the row by token only; the favourites it exposes are resolved server-side
  to product names/slugs (never PII).
- **`instagram_posts`** (`id`, `image_url text`, `link_url text`, `caption text`,
  `sort_order int`, `is_active bool`, timestamps). RLS public read where `is_active`.
- **`checkout_intents`** (`id`, `email text`, `items jsonb`, `subtotal_cents int`,
  `created_at`, `reminded_at` null, `converted_order_id uuid` null). RLS: service-role only.

### 4.8 Storage
- New public-read bucket **`review-images`**; writes via service-role action only;
  validate content-type (image/*) and size (e.g. ≤ 5 MB) before upload.

## 5. Feature behavior

### Workstream 1 — Catalog foundation
- **Dietary tags:** add the 3 enum values + `dietaryMeta` labels; extend the existing
  `MenuBrowser` multi-select filter (already only shows tags present in the catalog).
- **Substitutions:** authored as product options (e.g. "Milk: Regular / Oat (+S$1.50)").
  Disclaimer component near allergen chips. No schema change beyond what options already
  support. Price deltas flow through the existing cart-key + `unitPriceCents` logic.

### Workstream 2 — Merchandising
- **Build-a-box:** product-like detail page driven by a `box_template`. Client picker
  enforces "choose exactly N"; `placeOrder` re-validates count + that each chosen product
  is eligible + available, then records one line at `price_cents` (selected items captured
  in `selected_options`/snapshot for the bake list & packing slip).
- **Bundles:** admin CRUD page; storefront bundle cards/detail; "Add bundle" → one cart
  line at `bundles.price_cents`; server validates all `bundle_items` are available at
  checkout.
- **Spend-gift nudge:** cart + checkout progress bar toward `free_gift_threshold_cents`;
  when subtotal ≥ threshold, server adds the `free_gift_product_id` as a S$0 line. Display
  copy reuses the free-delivery nudge component.

### Workstream 3 — Inventory & scheduling ops
- **Stock limits:** admin sets `stock_count`; `markOrderPaid` decrements by ordered qty
  (idempotent guard like points/referrals) and flips `is_available=false` at 0. Untracked
  when null.
- **Back-in-stock (linked):** sold-out product page shows "Email me when it's back" (email
  prefilled for signed-in users), rate-limited. Favouriting a sold-out item auto-inserts a
  `stock_notifications` row for the signed-in user's email. "Saved treats" marks sold-out
  favourites + a one-tap subscribe. When admin sets a product available (stock > 0 or manual
  toggle), a server action emails all un-notified subscribers (best-effort) and stamps
  `notified_at`.
- **Per-window caps:** `placeOrder` counts non-cancelled orders for
  (scheduled_date, time_window); rejects when ≥ `per_window_cap`. Admin field on Settings.
- **Cutoff countdown:** earliest-date logic adds a day when `now > daily_cutoff_time`; a
  storefront banner renders a live countdown to today's cutoff. Admin sets the time.
- **Packing slips:** admin-only print page grouped by fulfillment day → each order's items,
  options, quantities, allergens, customer/fulfillment info. `requireAdmin`, no public route,
  print-friendly CSS.

### Workstream 4 — Lifecycle email
- **Abandoned cart:** capture/update a `checkout_intents` row when the customer provides an
  email at checkout (keyed by email; cleared/marked on successful order). Daily/often cron
  route (secret-authed) finds intents older than `abandoned_after_hours` with `reminded_at`
  null and no paid order for that email since `created_at`, sends one reminder, stamps
  `reminded_at`.
- **Birthday rewards:** account profile gains a birthday field. The **same cron route** finds
  profiles whose birthday is today and `birthday_rewarded_year` < current year, grants
  `birthday_reward_points` via `points_ledger` (reason `birthday`), emails a greeting, sets
  `birthday_rewarded_year`. Idempotent by the year guard.

### Workstream 5 — Social proof & content
- **Photo reviews:** review form gains optional photo upload (→ `review-images` bucket →
  `reviews.image_paths`); product reviews list renders thumbnails (lightbox optional).
  Auto-publish; admin reviews-management can hide/delete. Gated by `feature_photo_reviews`
  (text reviews still governed by existing `reviews` flag).
- **Cart sharing:** a "Share this order" button on the cart encodes the basket as a compact
  payload `[{ productId, optionValueLabels, qty }]` (base64 in the URL — no DB row, works for
  guests on both ends). Opening `/cart/shared?c=<payload>` re-resolves each line against the
  **current** catalog via the existing `buildReorderCart` re-resolution logic (current price +
  availability; unavailable lines skipped with a notice) and loads them into the opener's
  cart. The payload is display-only and re-priced/re-validated at checkout, so a stale or
  tampered link can't mis-charge. Gated by `feature_cart_sharing`.
- **Wishlist sharing:** account action mints/returns a `wishlist_shares` token; "Share my
  wishlist" copies `/wishlist/share/<token>`. Public page lists the user's current
  favourites (names, prices, links) with "add all to cart." Names only, no PII. Gated by
  `feature_wishlist_sharing`.
- **Instagram:** admin CRUD for `instagram_posts`; storefront grid (home and/or footer) +
  "Follow us" CTA; only `is_active` shown, ordered by `sort_order`.
- **Structured order notes:** admin defines `note_prompts` in Settings; checkout renders
  them (text / yes-no), validates `required` ones, stores answers in
  `orders.note_answers` (free-text `notes` stays separate), and includes them
  (HTML-escaped) in the owner email + admin order detail.

## 6. Admin surfaces

- **Settings → Features:** 11 new checkboxes (extends the existing tuple-mapped list).
- **Settings → other sections:** per-window cap, cutoff time, spend-gift threshold +
  product, birthday points, abandoned-after hours, structured note-prompt editor.
- **Products form:** `stock_count` field; substitution options use the existing option
  editor.
- **New admin pages:** Bundles (CRUD), Build-a-box templates (CRUD), Instagram posts (CRUD),
  Packing slips (print). Nav links added to `AdminShell`.
- **Reviews management:** hide/delete + photo visibility.
- All new admin reads/writes go through `admin-actions.ts` / `admin-db.ts` with
  `requireAdmin()`.

## 7. Security — OWASP Top 10 (2025)

- **A01 Broken Access Control:** `requireAdmin()` on every new admin action; public read
  limited to `is_active` rows (bundles/boxes/IG); packing slips admin-only (PII); wishlist
  share token unguessable (≥128-bit), exposes favourites only; `stock_notifications` /
  `checkout_intents` service-role only.
- **A02 Cryptographic / Data exposure:** share tokens from a CSPRNG; no secrets to client;
  recipient/PII fields never returned to public endpoints. The cart-share payload carries no
  identity — only product ids/labels/quantities — and is re-resolved + re-priced server-side,
  so it's display-only and tamper-safe.
- **A03 Injection / XSS:** parameterized Supabase queries; note-answers, IG captions, review
  text escaped in emails/HTML (reuse gift-message escaping).
- **A04 Insecure Design:** cron route gated by a secret `Authorization` header so no one can
  trigger mass emails (email-bomb abuse); back-in-stock + checkout-intent capture
  rate-limited (anti-spam/enumeration); stock decrement + birthday grant idempotent.
- **A05 Security Misconfiguration:** manual IG curation keeps CSP tight (no third-party
  script); review-images bucket public-read but service-role-write; new env (`CRON_SECRET`)
  documented for Vercel.
- **A06 Vulnerable Components:** no new heavy deps (no Meta SDK); reuse existing Supabase/
  Stripe/Resend clients.
- **A07 Auth Failures:** birthday/wishlist tied to authenticated user; share links are
  read-only and revocable.
- **A08 Integrity Failures:** cron auth; idempotent ledger writes via unique indexes.
- **A09 Logging/Monitoring:** best-effort email/SMS failures logged, never thrown.
- **A10 SSRF:** manual IG curation does not fetch remote content server-side; review images
  are user-uploaded to our Storage (no server-side URL fetch). Final audit pass at the end
  re-checks all new endpoints against this list.

## 8. Verification (end-to-end, dev server + Playwright + Supabase MCP)

Per feature: toggle its flag off → confirm it vanishes from storefront AND the server action
refuses it; toggle on → works. Spot DB checks for each new table/column. Specifically:
build-a-box rejects wrong count/ineligible item server-side; bundle line totals correct;
spend-gift adds the S$0 line at threshold; stock decrements + auto sold-out; back-in-stock
subscribe (member via ribbon + guest via email) then restock sends one email; per-window cap
blocks the (N+1)th order in a window; cutoff pushes earliest date; packing slip groups by day
with allergens; abandoned-cart cron (manually triggered) emails once; birthday cron grants
once per year; photo review uploads + renders; cart-share link reloads the basket re-priced (skips
unavailable lines); wishlist share link shows favourites, no PII;
IG grid renders active posts; structured notes appear on order + owner email. `npx tsc
--noEmit` clean after each workstream. Final OWASP pass.

## 9. Implementation notes / gotchas

- Enum `ADD VALUE` in its own pre-migration (section 4.1).
- New client-gated components import `FeatureFlags` as `import type` (settings.ts is
  server-only).
- Cron route must read a server-only `CRON_SECRET`; locally trigger via an authed request to
  test. Document `vercel.json` cron + env at deploy (launch-config checklist).
- Stock decrement / birthday grant reuse the partial-unique-index idempotency pattern from
  points/referrals.
- Feature count is growing; keep the admin Features section tuple-driven so additions stay
  one-line.

## 10. Out of scope (deferred)

Recurring/subscription orders; WhatsApp-first flows; PayNow-as-hero; postal-code delivery
zones; option-level stock; dynamic allergen recomputation; Instagram Graph API;
review pre-moderation queue.
