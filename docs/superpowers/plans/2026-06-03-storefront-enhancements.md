# Storefront Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 15 admin-toggleable storefront features (merchandising, inventory/scheduling ops, lifecycle email, social proof) to the live Michelle's Munchies app, each gated by a feature flag and manageable from the admin, with an OWASP Top 10 (2025) pass.

**Architecture:** Extends the existing pattern — feature flags as boolean columns on `settings` surfaced through `FeatureFlags`/`FeaturesProvider`; privileged writes in `"use server"` actions on the service-role client with `requireAdmin()`; storefront reads on the anon client; money in integer cents; emails/SMS best-effort. New scheduled work (abandoned-cart, birthday) runs through one secret-authed Vercel Cron route.

**Tech Stack:** Next.js 15 App Router + TypeScript, Tailwind v4, Supabase (Postgres + RLS + Storage), Stripe, Resend, Vercel Cron.

**Source spec:** `docs/superpowers/specs/2026-06-03-storefront-enhancements-design.md`

---

## Conventions for this plan (read first)

- **This repo has no unit-test runner.** Do not add one. Each task's verification step uses the project's real harness:
  - `npx tsc --noEmit` — type safety (run after every code task).
  - `npm run lint` — ESLint (run at end of each workstream).
  - **Playwright MCP** — drive the dev server (`npm run dev`, port 3000) to verify UI behavior.
  - **Supabase MCP** `execute_sql` (project `ddwesutmtlytbcluqcuc`) — verify rows/columns.
  - Migrations are applied via Supabase MCP `apply_migration` AND saved as a numbered file under `supabase/migrations/`.
- **Feature-flag gating is mandatory and dual:** every new feature gates the client UI via `useFeatures()` AND its server action via `fetchStoreSettings().features` (hiding UI is not security).
- **Client components import flags as `import type { FeatureFlags }`** — `settings.ts` is server-only.
- **Commit after each task.** Commits require Task 0 (git init) to have run; if the user declined git, skip the commit steps.
- **File map (existing, frequently touched):** `src/lib/settings.ts`, `src/lib/admin-db.ts`, `src/lib/admin-actions.ts`, `src/lib/admin-auth.ts` (`requireAdmin`), `src/lib/orders-db.ts` (`createOrder`), `src/lib/order.ts` (`computeDeliveryFeeCents`, `earliestFulfillmentDate`), `src/lib/email.ts`, `src/lib/rate-limit.ts`, `src/lib/catalog.ts` (`dietaryMeta`, `formatPrice`), `src/lib/products.ts` (`rowToProduct`), `src/components/features/FeaturesProvider.tsx`, `src/components/admin/{AdminStore,AdminShell}.tsx`, `src/app/admin/(panel)/settings/page.tsx`, `src/app/checkout/{page,actions}.tsx`, `src/app/api/stripe/webhook/route.ts` (`markOrderPaid` lives in `admin-db.ts`).

---

## Stage 0 — Foundation (shared; do entirely before any workstream)

### Task 0: Initialize git (recommended, one-time)

**Files:** Create `.gitignore` (if missing — verify `.next`, `node_modules`, `.env*.local`, `.playwright-mcp/` are ignored).

- [ ] **Step 1:** Confirm with the user that git init is wanted (the repo is currently not version-controlled). If declined, skip this task and all commit steps in the plan.
- [ ] **Step 2:** Ensure `.gitignore` ignores `node_modules/`, `.next/`, `.env*.local`, `.playwright-mcp/`, `*.png` screenshots.

Run: `git init; git add -A; git commit -m "chore: baseline before storefront enhancements"`
Expected: initial commit created.

---

### Task 1: Migration — enum values (separate, committed before use)

**Files:** Create `supabase/migrations/0010_dietary_enum_values.sql` (use the next free number).

- [ ] **Step 1: Write the migration**

```sql
alter type dietary_tag add value if not exists 'vegan';
alter type dietary_tag add value if not exists 'dairy_free';
alter type dietary_tag add value if not exists 'gluten_free';
```

- [ ] **Step 2: Apply via Supabase MCP** `apply_migration` (name `dietary_enum_values`). Enum `ADD VALUE` must be its OWN migration — it cannot be used in the same transaction it's added in.
- [ ] **Step 3: Verify**

Run (Supabase MCP `execute_sql`): `select enum_range(null::dietary_tag);`
Expected: includes `vegan`, `dairy_free`, `gluten_free`.

- [ ] **Step 4: Commit** — `git add supabase/migrations/0010_dietary_enum_values.sql && git commit -m "feat(db): add vegan/dairy_free/gluten_free dietary tags"`

---

### Task 2: Migration — new columns, tables, storage

**Files:** Create `supabase/migrations/0011_storefront_enhancements.sql`.

- [ ] **Step 1: Write the migration** (apply in this order; references the enum values from Task 1 which are now committed)

```sql
-- settings: 11 feature flags (default true) + config columns
alter table settings
  add column if not exists feature_build_a_box      boolean not null default true,
  add column if not exists feature_bundles          boolean not null default true,
  add column if not exists feature_spend_gift       boolean not null default true,
  add column if not exists feature_back_in_stock    boolean not null default true,
  add column if not exists feature_photo_reviews    boolean not null default true,
  add column if not exists feature_cart_sharing     boolean not null default true,
  add column if not exists feature_wishlist_sharing boolean not null default true,
  add column if not exists feature_instagram        boolean not null default true,
  add column if not exists feature_birthday_rewards boolean not null default true,
  add column if not exists feature_abandoned_cart   boolean not null default true,
  add column if not exists feature_structured_notes boolean not null default true,
  add column if not exists per_window_cap        int,
  add column if not exists daily_cutoff_time      time,
  add column if not exists free_gift_threshold_cents int,
  add column if not exists free_gift_product_id   uuid references products(id) on delete set null,
  add column if not exists birthday_reward_points int  not null default 0,
  add column if not exists abandoned_after_hours  int  not null default 4,
  add column if not exists note_prompts           jsonb not null default '[]'::jsonb;

-- products: optional stock tracking
alter table products add column if not exists stock_count int;

-- profiles: birthday + idempotency guard
alter table profiles
  add column if not exists birthday date,
  add column if not exists birthday_rewarded_year int;

-- orders: structured note answers (free-text notes column unchanged)
alter table orders add column if not exists note_answers jsonb not null default '[]'::jsonb;

-- reviews: photo URLs
alter table reviews add column if not exists image_paths text[] not null default '{}';

-- bundles
create table if not exists bundles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  price_cents int not null check (price_cents >= 0),
  image_path text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists bundle_items (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references bundles(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  quantity int not null default 1 check (quantity > 0)
);

-- build-a-box templates
create table if not exists box_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  item_count int not null check (item_count > 0),
  price_cents int not null check (price_cents >= 0),
  eligible_category text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists box_template_items (
  id uuid primary key default gen_random_uuid(),
  box_template_id uuid not null references box_templates(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade
);

-- back-in-stock subscriptions
create table if not exists stock_notifications (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  email text not null,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  notified_at timestamptz
);
create unique index if not exists stock_notifications_unique
  on stock_notifications (product_id, lower(email)) where notified_at is null;

-- wishlist share tokens
create table if not exists wishlist_shares (
  token text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- instagram posts (manual curation)
create table if not exists instagram_posts (
  id uuid primary key default gen_random_uuid(),
  image_url text not null,
  link_url text not null,
  caption text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- abandoned-cart intents
create table if not exists checkout_intents (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  items jsonb not null,
  subtotal_cents int not null default 0,
  created_at timestamptz not null default now(),
  reminded_at timestamptz,
  converted_order_id uuid references orders(id) on delete set null
);
create index if not exists checkout_intents_pending
  on checkout_intents (created_at) where reminded_at is null and converted_order_id is null;

-- RLS: enable on all new tables
alter table bundles enable row level security;
alter table bundle_items enable row level security;
alter table box_templates enable row level security;
alter table box_template_items enable row level security;
alter table stock_notifications enable row level security;
alter table wishlist_shares enable row level security;
alter table instagram_posts enable row level security;
alter table checkout_intents enable row level security;

-- Public read only for active merchandising/content; everything else service-role only.
create policy "public reads active bundles" on bundles for select using (is_active);
create policy "public reads bundle items" on bundle_items for select using (
  exists (select 1 from bundles b where b.id = bundle_id and b.is_active));
create policy "public reads active box templates" on box_templates for select using (is_active);
create policy "public reads box items" on box_template_items for select using (
  exists (select 1 from box_templates t where t.id = box_template_id and t.is_active));
create policy "public reads active instagram" on instagram_posts for select using (is_active);
create policy "public reads share row by token" on wishlist_shares for select using (true);
-- stock_notifications, checkout_intents: NO policies → service-role only.
```

- [ ] **Step 2: Apply** via Supabase MCP `apply_migration` (name `storefront_enhancements`).
- [ ] **Step 3: Verify** — `select column_name from information_schema.columns where table_name='settings' and column_name like 'feature_%';` → 17 rows (6 existing + 11 new). `select count(*) from information_schema.tables where table_name in ('bundles','bundle_items','box_templates','box_template_items','stock_notifications','wishlist_shares','instagram_posts','checkout_intents');` → 8.
- [ ] **Step 4: Create the `review-images` Storage bucket** (Supabase MCP or dashboard): public read, name `review-images`. Verify it appears in `storage.buckets`.
- [ ] **Step 5: Commit** — `git add supabase/migrations/0011_storefront_enhancements.sql && git commit -m "feat(db): storefront-enhancements schema (flags, tables, columns)"`

---

### Task 3: FeatureFlags type + settings mapping

**Files:** Modify `src/lib/settings.ts`.

- [ ] **Step 1:** Extend `FeatureFlags` with the 11 new keys (`buildABox`, `bundles`, `spendGift`, `backInStock`, `photoReviews`, `cartSharing`, `wishlistSharing`, `instagram`, `birthdayRewards`, `abandonedCart`, `structuredNotes`), add them (all `true`) to `ALL_FEATURES_ON`, add the columns to `SETTINGS_SELECT`, and map each `row.feature_x ?? true` in `rowToStoreSettings`. Add the new config fields to `StoreSettings` (`perWindowCap: number | null`, `dailyCutoffTime: string | null`, `freeGiftThresholdCents: number | null`, `freeGiftProductId: string | null`, `birthdayRewardPoints: number`, `abandonedAfterHours: number`, `notePrompts: NotePrompt[]`) with `DEFAULTS`. Define and export `type NotePrompt = { id: string; label: string; type: "text" | "boolean"; required: boolean }`.
- [ ] **Step 2:** `npx tsc --noEmit` → expect failures in `FeaturesProvider.tsx`/`AdminStore.tsx` (handled next). Fix only `settings.ts` type errors here.
- [ ] **Step 3: Commit** — `git commit -am "feat(settings): add new feature flags + config fields"`

---

### Task 4: FeaturesProvider, admin settings type, admin-db mapping

**Files:** Modify `src/components/features/FeaturesProvider.tsx`, `src/components/admin/AdminStore.tsx`, `src/lib/admin-db.ts`, `src/app/admin/(panel)/settings/page.tsx`.

- [ ] **Step 1:** `FeaturesProvider.tsx` — add the 11 keys to its local `ALL_ON` fallback (keep `import type { FeatureFlags }`).
- [ ] **Step 2:** `admin-db.ts` — add the 11 `feature_*` columns + 7 config columns to `SettingsRow`; map them in `fetchAdminSettings`; write them in `updateSettings` (`if (patch.features !== undefined) { columns.feature_build_a_box = patch.features.buildABox; ... }` and the config columns).
- [ ] **Step 3:** `AdminStore.tsx` — extend `AdminSettings.features` + defaults with the 11 keys, and add the config fields.
- [ ] **Step 4:** `settings/page.tsx` — extend the Features-section tuple list with the 11 new `[key, label, desc]` entries; add inputs for the config fields in the relevant sections (per-window cap + cutoff time in "Delivery & orders"; spend-gift threshold + product picker; birthday points + abandoned-after-hours in "Rewards"/"Email"; a `note_prompts` editor — Task 19).
- [ ] **Step 5:** `npx tsc --noEmit` → PASS. Then Playwright: open `/admin/settings`, confirm 17 feature checkboxes render and save (DB check: toggle one off → `select feature_bundles from settings where id=1` reflects it → toggle back on).
- [ ] **Step 6: Commit** — `git commit -am "feat(admin): surface new feature flags + config in Settings"`

---

## Stage 1 — Catalog foundation

### Task 5: Dietary tags (vegan / dairy-free / gluten-free) + filter

**Files:** Modify `src/lib/catalog.ts` (`dietaryMeta`), `src/lib/types.ts` (`DietaryTag`), `src/components/product/MenuBrowser.tsx`.

- [ ] **Step 1:** `types.ts` — extend `DietaryTag` union with `"vegan" | "dairy_free" | "gluten_free"`.
- [ ] **Step 2:** `catalog.ts` — add `dietaryMeta` entries: `vegan: { label: "Vegan" }`, `dairy_free: { label: "Dairy-free" }`, `gluten_free: { label: "Gluten-free" }`.
- [ ] **Step 3:** `MenuBrowser.tsx` — the existing multi-select already renders only tags present in the catalog, so no logic change; confirm new tags appear once a product carries them.
- [ ] **Step 4:** `npx tsc --noEmit` → PASS.
- [ ] **Step 5: Verify** — set a product's tags via SQL: `update products set dietary_tags = '{vegan,dairy_free}' where slug='earl-grey-shortbread';` Playwright `/menu` → the "Vegan"/"Dairy-free" filter chips appear and filter to that product. Revert the test row after.
- [ ] **Step 6: Commit** — `git commit -am "feat(menu): add vegan/dairy-free/gluten-free dietary tags + filters"`

### Task 6: Ingredient substitutions (priced options + disclaimer)

**Files:** Create `src/components/product/SubstitutionNote.tsx`; modify `src/app/menu/[slug]/page.tsx`.

Substitutions reuse the existing `ProductOption`/`ProductOptionValue` system (no schema change) — admin authors e.g. an option "Milk" with values "Regular (+0)" / "Oat (+150)". This task only adds the safety disclaimer near allergen chips.

- [ ] **Step 1:** Create `SubstitutionNote.tsx` — a small client/server component rendering: "Substitutions change the recipe. If you have allergies, tell us in the order notes and we'll confirm." Styled like existing allergen helper text.
- [ ] **Step 2:** Render it on the product detail page beneath the allergen chips, only when the product has at least one option whose name matches a substitution heuristic (e.g. name in `["Milk","Butter","Flour","Sugar"]`) OR always when the product has options — choose: render whenever `product.options.length > 0`.
- [ ] **Step 3:** `npx tsc --noEmit` → PASS. Playwright: product with options shows the note; option price delta still flows to cart (`unitPriceCents`).
- [ ] **Step 4: Commit** — `git commit -am "feat(menu): substitution disclaimer near allergens"`
- [ ] **Step 5:** `npm run lint` (end of Stage 1) → clean.

---

## Stage 2 — Merchandising

### Task 7: Bundles — data layer + public read

**Files:** Create `src/lib/bundles.ts`; modify `src/lib/types.ts`.

- [ ] **Step 1:** `types.ts` — add `type Bundle = { id; name; slug; description?; priceCents; imageUrl?; items: { productId; productName; quantity }[] }`.
- [ ] **Step 2:** `bundles.ts` — `fetchActiveBundles()` and `fetchBundleBySlug(slug)` via the public client (joins `bundle_items` → `products` for names); map snake→camel. Server-only.
- [ ] **Step 3:** `npx tsc --noEmit` → PASS.
- [ ] **Step 4: Verify** — insert a test bundle + items via SQL; call is exercised in Task 8. Commit — `git commit -am "feat(bundles): data layer"`

### Task 8: Bundles — storefront + add-to-cart (gated `bundles`)

**Files:** Create `src/app/bundles/page.tsx`, `src/app/bundles/[slug]/page.tsx`, `src/components/product/BundleCard.tsx`, `src/components/product/AddBundleButton.tsx`.

- [ ] **Step 1:** Bundle list + detail pages (server components) reading `fetchActiveBundles`/`fetchBundleBySlug`; gate with `(await fetchStoreSettings()).features.bundles` → `notFound()` when off.
- [ ] **Step 2:** `AddBundleButton` (client) adds one `CartItem` with `key = "bundle::<slug>"`, `productId = bundleId`, `name`, `unitPriceCents = priceCents`, `quantity`, `selectedOptions = []` (the contained items recorded in a `bundleContents` note for display). Use `useCart().addItem`. Hide when `!useFeatures().bundles`.
- [ ] **Step 3:** Server validation in `placeOrder` (`src/app/checkout/actions.ts`): for any bundle line, re-fetch the bundle, assert `is_active` and all `bundle_items` products `is_available`; reject otherwise. Recompute its price from `bundles.price_cents` (never trust client). Skip entirely if `!settings.features.bundles`.
- [ ] **Step 4:** Add a "Bundles" nav link to the storefront header (gated by the flag) and a `/bundles` entry where appropriate.
- [ ] **Step 5:** `npx tsc --noEmit` → PASS. Playwright: bundle detail → add → cart shows one line at bundle price → checkout places order; toggle `bundles` off → pages 404 + button gone.
- [ ] **Step 6: Commit** — `git commit -am "feat(bundles): storefront + cart + checkout validation"`

### Task 9: Bundles — admin CRUD

**Files:** Create `src/app/admin/(panel)/bundles/page.tsx`; modify `src/lib/admin-db.ts`, `src/lib/admin-actions.ts`, `src/components/admin/AdminShell.tsx`.

- [ ] **Step 1:** `admin-db.ts` — `fetchAdminBundles`, `createBundle`, `updateBundle`, `deleteBundle` (service-role; manage `bundle_items` as a set).
- [ ] **Step 2:** `admin-actions.ts` — wrap each in a `"use server"` action that calls `await requireAdmin()` first.
- [ ] **Step 3:** Admin page — list + create/edit modal (name, slug, price, description, active, item picker with quantities). Mirror the existing `promos` admin page structure.
- [ ] **Step 4:** `AdminShell.tsx` — add "Bundles" nav link.
- [ ] **Step 5:** `npx tsc --noEmit` → PASS. Playwright (signed-in admin): create a bundle → appears on `/bundles`. Confirm a logged-out call to the action is rejected (requireAdmin).
- [ ] **Step 6: Commit** — `git commit -am "feat(admin): bundles CRUD"`

### Task 10: Build-a-box — data + storefront picker (gated `buildABox`)

**Files:** Create `src/lib/boxes.ts`, `src/app/build-a-box/[slug]/page.tsx`, `src/components/product/BoxBuilder.tsx`.

- [ ] **Step 1:** `boxes.ts` — `fetchActiveBoxTemplates()`, `fetchBoxBySlug(slug)` returning `{ id, name, slug, itemCount, priceCents, eligibleProducts: Product[] }` (eligible = `box_template_items` join, else products in `eligible_category`).
- [ ] **Step 2:** `BoxBuilder` (client) — pick exactly `itemCount` items (quantity steppers across eligible products, live "X of N chosen", disable add when full). On add: one `CartItem` `key = "box::<slug>::" + chosenIds.sort().join(",")`, `unitPriceCents = priceCents`, `selectedOptions` snapshot listing chosen items for bake-list/packing-slip. Gate via `useFeatures().buildABox`.
- [ ] **Step 3:** Page gates with `features.buildABox` → `notFound()` when off.
- [ ] **Step 4:** `placeOrder` server validation: for a box line, assert chosen count == template `item_count`, each chosen product eligible + available; price = template `price_cents`. Reject mismatch. Skip if flag off.
- [ ] **Step 5:** `npx tsc --noEmit` → PASS. Playwright: pick 12 → add → cart line at flat price; attempt to tamper count is rejected server-side (verify by asserting the action rejects a forged 11-item payload). Toggle off → 404.
- [ ] **Step 6: Commit** — `git commit -am "feat(build-a-box): storefront picker + server validation"`

### Task 11: Build-a-box — admin CRUD

**Files:** Create `src/app/admin/(panel)/build-a-box/page.tsx`; modify `admin-db.ts`, `admin-actions.ts`, `AdminShell.tsx`.

- [ ] **Step 1:** CRUD for `box_templates` + `box_template_items` (name, slug, item_count, price, eligible_category or explicit product allowlist, active). `requireAdmin()` on each action.
- [ ] **Step 2:** Nav link "Build-a-box".
- [ ] **Step 3:** `npx tsc --noEmit` → PASS. Playwright: create a template → appears at `/build-a-box/<slug>`.
- [ ] **Step 4: Commit** — `git commit -am "feat(admin): build-a-box templates CRUD"`

### Task 12: Spend-gift nudge (gated `spendGift`)

**Files:** Modify `src/app/checkout/actions.ts`, `src/app/checkout/page.tsx`, the cart nudge component, `src/app/admin/(panel)/settings/page.tsx`.

- [ ] **Step 1:** Settings already has `free_gift_threshold_cents` + `free_gift_product_id` (Task 2/4). Admin Settings: add threshold input + a product dropdown to pick the free gift.
- [ ] **Step 2:** Cart/checkout: progress copy "Spend S$X more for a free <product>" when `features.spendGift && threshold` and subtotal < threshold; reuse the free-delivery nudge component.
- [ ] **Step 3:** `placeOrder`: when `features.spendGift && threshold && subtotal >= threshold && freeGiftProductId`, append a S$0 line for that product (server-side, not client-trusted). Idempotent (only one gift line).
- [ ] **Step 4:** `npx tsc --noEmit` → PASS. Playwright: set threshold S$30 + a gift product; cart at S$32 → free line added at checkout; below → nudge shows; toggle off → neither.
- [ ] **Step 5: Commit** — `git commit -am "feat(checkout): spend-gift threshold nudge"`
- [ ] **Step 6:** `npm run lint` (end of Stage 2) → clean.

---

## Stage 3 — Inventory & scheduling ops

### Task 13: Stock limits (auto sold-out on paid)

**Files:** Modify `src/lib/products.ts` (`rowToProduct` + select), `src/lib/types.ts` (`Product.stockCount?`), `src/lib/admin-db.ts` (`markOrderPaid`, `toProductColumns`, product CRUD), product admin form.

- [ ] **Step 1:** `types.ts` — add `stockCount?: number | null`; `products.ts` — select + map `stock_count`.
- [ ] **Step 2:** Admin product form — add a "Stock count (blank = untracked)" field; persist via `toProductColumns`.
- [ ] **Step 3:** `markOrderPaid` — after marking paid, for each order item whose product has non-null `stock_count`, decrement by qty and set `is_available=false` when it reaches ≤0. Make it idempotent: guard on the same paid-transition that already gates points (do the decrement inside the existing "first time this order becomes paid" block so re-delivered webhooks don't double-decrement).
- [ ] **Step 4:** `npx tsc --noEmit` → PASS. Verify: set `stock_count=1` on a product, place + pay an order for it (Stripe test flow or simulate `markOrderPaid`), confirm `stock_count=0` and `is_available=false`; replay the webhook → no further decrement.
- [ ] **Step 5: Commit** — `git commit -am "feat(inventory): per-product stock with auto sold-out"`

### Task 14: Back-in-stock notifications, linked to wishlist (gated `backInStock`)

**Files:** Create `src/lib/stock-notify.ts`, `src/app/products/notify-actions.ts` (or colocate in product detail actions), `src/components/product/NotifyBackInStock.tsx`; modify `FavouriteButton.tsx`, account "Saved treats", `markOrderPaid`/admin availability toggle.

- [ ] **Step 1:** `stock-notify.ts` (service-role): `subscribeBackInStock(productId, email, userId?)` (insert, ignore unique-violation), `notifySubscribers(productId)` (select where `notified_at is null`, send best-effort email via `email.ts`, stamp `notified_at`).
- [ ] **Step 2:** Server action `subscribeBackInStockAction` — rate-limited (`rate-limit.ts`, e.g. 10/5min), gated by `features.backInStock`, validates email; resolves signed-in user's email server-side when present.
- [ ] **Step 3:** `NotifyBackInStock` (client) — shown on sold-out product detail; email prefilled if signed in; hidden when `!useFeatures().backInStock`.
- [ ] **Step 4:** `FavouriteButton.tsx` — when the favourited product is sold out and user signed in, also call `subscribeBackInStockAction` (the ribbon = "tell me when it's back"). Account "Saved treats" marks sold-out favourites + shows a subscribe affordance.
- [ ] **Step 5:** Trigger `notifySubscribers(productId)` when a product transitions to available — in `markOrderPaid` is wrong; instead call it from the admin product update action whenever `is_available` flips false→true OR `stock_count` goes 0→positive.
- [ ] **Step 6:** `npx tsc --noEmit` → PASS. Verify: sold-out product → guest email subscribe inserts a row; signed-in favourite of a sold-out item inserts a row; admin sets available → one email per subscriber, `notified_at` stamped, no dupes. Toggle flag off → button gone + action refuses.
- [ ] **Step 7: Commit** — `git commit -am "feat(inventory): back-in-stock alerts linked to wishlist"`

### Task 15: Per-time-window order caps

**Files:** Modify `src/app/checkout/actions.ts` (`placeOrder`), admin Settings (field already added in Task 4).

- [ ] **Step 1:** In `placeOrder`, after the existing daily-cap check: if `settings.perWindowCap` is set (>0) and `input.timeWindow` present, count non-cancelled orders for `(scheduled_date, time_window)` via the admin client; reject with "That time slot is fully booked — please pick another window." when `>= perWindowCap`.
- [ ] **Step 2:** `npx tsc --noEmit` → PASS. Verify: set `per_window_cap=1`; place one order for a (date, window); a second for the same slot is rejected; a different window same date is allowed.
- [ ] **Step 3: Commit** — `git commit -am "feat(scheduling): per-time-window order caps"`

### Task 16: Lead-time cutoff countdown

**Files:** Modify `src/lib/order.ts` (`earliestFulfillmentDate`), create `src/components/checkout/CutoffBanner.tsx`; admin Settings field from Task 4.

- [ ] **Step 1:** `order.ts` — extend earliest-date logic: accept an optional `cutoffTime` (HH:MM); if the current local time is past the cutoff, add one extra day to the earliest fulfillment date. Keep the signature backward-compatible (default no cutoff).
- [ ] **Step 2:** `placeOrder` passes `settings.dailyCutoffTime` into the earliest-date check so the server enforces the pushed date.
- [ ] **Step 3:** `CutoffBanner` (client) — shows "Order by <cutoff> for <earliest day>" with a live countdown; rendered on checkout when `dailyCutoffTime` set.
- [ ] **Step 4:** `npx tsc --noEmit` → PASS. Verify: set cutoff to a past time → earliest date shifts +1 day and an order for the old earliest date is rejected; banner shows countdown.
- [ ] **Step 5: Commit** — `git commit -am "feat(scheduling): same-day cutoff + countdown banner"`

### Task 17: Printable packing slips (admin-only)

**Files:** Create `src/app/admin/(panel)/packing-slips/page.tsx`; modify `AdminShell.tsx`.

- [ ] **Step 1:** Admin client page reading `useAdmin()` orders; group non-cancelled by `scheduledDate` (upcoming first); per order render items + options + quantities + each product's allergens + customer/fulfillment info. Print-friendly CSS (`@media print`, page breaks per day).
- [ ] **Step 2:** No public route; the page lives under the admin `(panel)` group already guarded by middleware + the data comes from admin-authed `loadAdminData`.
- [ ] **Step 3:** Nav link "Packing slips".
- [ ] **Step 4:** `npx tsc --noEmit` → PASS. Playwright (admin): page groups orders by day with allergens; print preview is sane.
- [ ] **Step 5: Commit** — `git commit -am "feat(admin): printable packing slips"`
- [ ] **Step 6:** `npm run lint` (end of Stage 3) → clean.

---

## Stage 4 — Lifecycle email (Vercel Cron)

### Task 18: Cron route + abandoned-cart capture (gated `abandonedCart`)

**Files:** Create `src/app/api/cron/route.ts`, `src/lib/checkout-intents.ts`, `vercel.json`; modify `src/app/checkout/page.tsx`/`actions.ts` (capture), `.env.local` (`CRON_SECRET`), `src/lib/email.ts` (reminder template).

- [ ] **Step 1:** `checkout-intents.ts` (service-role): `recordIntent(email, items, subtotalCents)` (upsert latest by email), `markConverted(email)` (set `converted_order_id` for that email's open intent), `sendAbandonedReminders(afterHours)` (select pending intents older than N hours with no paid order for the email since `created_at`; send one reminder; stamp `reminded_at`).
- [ ] **Step 2:** Capture: when the customer provides an email at checkout (debounced) call a `recordCheckoutIntentAction` (gated `features.abandonedCart`, rate-limited). On successful order, `placeOrder` calls `markConverted(email)`.
- [ ] **Step 3:** `src/app/api/cron/route.ts` — `GET` handler that checks `Authorization: Bearer ${process.env.CRON_SECRET}` (constant-time compare); if missing/wrong → 401. On success, runs `sendAbandonedReminders(settings.abandonedAfterHours)` AND `grantBirthdayRewards()` (Task 20). Returns a JSON summary. Never exposes secrets.
- [ ] **Step 4:** `vercel.json` — add a daily (or hourly) cron hitting `/api/cron`. Document `CRON_SECRET` in the launch checklist. Add `CRON_SECRET` to `.env.local` for local testing.
- [ ] **Step 5:** `email.ts` — add `sendAbandonedCartEmail(to, items)` (best-effort, escaped).
- [ ] **Step 6:** `npx tsc --noEmit` → PASS. Verify: insert a stale intent via SQL; `curl`/fetch `/api/cron` with the secret → reminder sent once, `reminded_at` stamped; without the secret → 401. Toggle `abandonedCart` off → capture action refuses + cron skips intents.
- [ ] **Step 7: Commit** — `git commit -am "feat(email): abandoned-cart capture + secured cron route"`

### Task 19: Structured order-note prompts (gated `structuredNotes`)

**Files:** Modify `src/app/admin/(panel)/settings/page.tsx` (prompt editor), `src/app/checkout/page.tsx` + `actions.ts`, `src/lib/orders-db.ts` (`createOrder` persists `note_answers`), `src/lib/email.ts` (owner email), admin order detail.

- [ ] **Step 1:** Settings — a `note_prompts` editor (add/edit/remove rows: label, type text|boolean, required). Persists the `jsonb` via `updateSettings`.
- [ ] **Step 2:** Checkout — when `features.structuredNotes`, render each prompt (text input / yes-no), validate `required` ones client- AND server-side; collect into `note_answers: [{id,label,answer}]`.
- [ ] **Step 3:** `createOrder`/`placeOrder` — persist `note_answers` on the order (separate from free-text `notes`). Server re-validates required prompts against current `settings.notePrompts`.
- [ ] **Step 4:** Owner email + admin order detail — render answers (HTML-escaped via the existing escaping helper).
- [ ] **Step 5:** `npx tsc --noEmit` → PASS. Verify: define prompts in admin; checkout shows them, blocks on a missing required one (server rejects a forged submission too); order row has `note_answers`; owner email includes them. Toggle off → only the free-text box remains.
- [ ] **Step 6: Commit** — `git commit -am "feat(checkout): admin-defined structured order notes"`

### Task 20: Birthday rewards (cron-driven, gated `birthdayRewards`)

**Files:** Modify `src/app/account/page.tsx` + `actions.ts` (birthday field), `src/lib/checkout-intents.ts` or a new `src/lib/birthday.ts`, `src/app/api/cron/route.ts`, `src/lib/email.ts`.

- [ ] **Step 1:** Account profile — add an optional birthday date input; `updateProfile` persists `profiles.birthday`.
- [ ] **Step 2:** `birthday.ts` (service-role): `grantBirthdayRewards()` — select profiles where `extract(month/day from birthday)` = today and (`birthday_rewarded_year is null or < current_year`) and `settings.birthdayRewardPoints > 0` and `features.birthdayRewards`; insert a `points_ledger` row (reason `birthday`), email a greeting, set `birthday_rewarded_year = current_year`. Idempotent by the year guard.
- [ ] **Step 3:** Wire `grantBirthdayRewards()` into the `/api/cron` handler (Task 18).
- [ ] **Step 4:** `rewardReasonLabel` (account ledger display) — add a label for `birthday`.
- [ ] **Step 5:** `npx tsc --noEmit` → PASS. Verify: set a profile birthday to today via SQL; hit `/api/cron` with the secret → points granted once + `birthday_rewarded_year` set; second run same year → no double-grant. Toggle off → cron skips.
- [ ] **Step 6: Commit** — `git commit -am "feat(rewards): birthday rewards via cron"`
- [ ] **Step 7:** `npm run lint` (end of Stage 4) → clean.

---

## Stage 5 — Social proof & content

### Task 21: Photo reviews (gated `photoReviews`)

**Files:** Create `src/lib/review-images.ts` (upload action); modify `src/lib/reviews.ts` (select/map `image_paths`), `src/lib/review-actions.ts` (`submitReview` accepts image URLs), the review form component, the product reviews list, admin reviews management.

- [ ] **Step 1:** `review-images.ts` — `uploadReviewImageAction(formData)` (service-role): validate content-type `image/*` + size ≤ 5 MB, upload to `review-images` bucket, return public URL. Mirror the existing `uploadProductImageAction`.
- [ ] **Step 2:** `reviews.ts` — select + map `image_paths` → `imageUrls`. `review-actions.ts` `submitReview(slug, productId, rating, body, imageUrls)` — persist via `upsertReview`; only accept images when `features.photoReviews` (else ignore them), keeping the existing `features.reviews` gate for the whole action.
- [ ] **Step 3:** Review form — optional photo upload control (thumbnails + remove), shown only when `useFeatures().photoReviews`. Product reviews list renders thumbnails.
- [ ] **Step 4:** Admin reviews management — hide/delete a review (and its photos).
- [ ] **Step 5:** `npx tsc --noEmit` → PASS. Playwright: submit a review with a photo → renders on the product; toggle `photoReviews` off → upload control gone + images ignored server-side; text reviews still work.
- [ ] **Step 6: Commit** — `git commit -am "feat(reviews): photo reviews"`

### Task 22: Cart sharing (gated `cartSharing`)

**Files:** Create `src/lib/cart-share.ts` (encode/decode), `src/app/cart/shared/page.tsx`, `src/components/cart/ShareCartButton.tsx`; modify `src/app/account/actions.ts` (reuse `buildReorderCart` re-resolution) or factor a shared resolver.

- [ ] **Step 1:** `cart-share.ts` — `encodeCart(items)` → base64url of `[{ p: productId, o: valueLabels[], q: qty }]`; `decodeCart(param)` → that shape (defensive parse, cap length). No PII.
- [ ] **Step 2:** Factor the line-resolution from `buildReorderCart` into a reusable `resolveSharedLines(rawLines)` returning `{ items: CartItem[]; skipped: string[] }` (re-prices against current catalog, skips unavailable). `buildReorderCart` calls it too (DRY).
- [ ] **Step 3:** `ShareCartButton` (client) — on the cart page; builds `/cart/shared?c=<encoded>` and copies it. Hidden when `!useFeatures().cartSharing`.
- [ ] **Step 4:** `/cart/shared/page.tsx` — decode, resolve via `resolveSharedLines`, load items into the opener's cart (client), show a "we updated prices / skipped X" notice, redirect to `/cart`. Gate with `features.cartSharing` (server) → `notFound()` when off.
- [ ] **Step 5:** `npx tsc --noEmit` → PASS. Playwright: build a cart, copy share link, open it in a fresh context → items load re-priced, unavailable lines skipped with a notice; toggle off → 404 + button gone.
- [ ] **Step 6: Commit** — `git commit -am "feat(cart): shareable cart link"`

### Task 23: Wishlist sharing (gated `wishlistSharing`)

**Files:** Create `src/lib/wishlist-share.ts`, `src/app/wishlist/share/[token]/page.tsx`, `src/components/account/ShareWishlistButton.tsx`; modify `src/app/account/actions.ts`.

- [ ] **Step 1:** `wishlist-share.ts` (service-role): `getOrCreateShareToken(userId)` → mints a CSPRNG token (`crypto.randomUUID()` ×2 or `randomBytes(16).toString("hex")`), upserts `wishlist_shares`; `fetchSharedFavourites(token)` → resolves the row's user's current favourites to `{ name, slug, priceCents }[]` (NO PII — names/prices/links only).
- [ ] **Step 2:** Server action `getWishlistShareLinkAction()` (auth'd user, gated `features.wishlistSharing`) returns `/wishlist/share/<token>`.
- [ ] **Step 3:** `ShareWishlistButton` in account "Saved treats" (hidden when `!useFeatures().wishlistSharing`).
- [ ] **Step 4:** `/wishlist/share/[token]/page.tsx` — public read-only list with per-item links + "add all to cart"; gate with `features.wishlistSharing` → `notFound()`.
- [ ] **Step 5:** `npx tsc --noEmit` → PASS. Playwright: signed-in user shares wishlist → open token link in fresh context → favourites listed, no PII (verify no email/name in the page/network); toggle off → 404.
- [ ] **Step 6: Commit** — `git commit -am "feat(wishlist): shareable read-only wishlist"`

### Task 24: Instagram feed (manual curation, gated `instagram`)

**Files:** Create `src/lib/instagram.ts`, `src/components/content/InstagramGrid.tsx`, `src/app/admin/(panel)/instagram/page.tsx`; modify `admin-db.ts`, `admin-actions.ts`, `AdminShell.tsx`, home page and/or footer.

- [ ] **Step 1:** `instagram.ts` — `fetchActiveInstagramPosts()` (public client, where `is_active` order by `sort_order`).
- [ ] **Step 2:** Admin CRUD (`requireAdmin()`): add/edit/remove posts (image_url, link_url, caption, sort, active). Nav link "Instagram".
- [ ] **Step 3:** `InstagramGrid` — renders posts as linked images + a "Follow us" CTA; shown on home/footer when `features.instagram` and there are active posts. Plain `<img>`/`next/image` + `<a>` only — NO third-party script (keeps CSP intact).
- [ ] **Step 4:** `npx tsc --noEmit` → PASS. Playwright: add a post in admin → grid renders on home; toggle off → grid gone.
- [ ] **Step 5: Commit** — `git commit -am "feat(content): curated Instagram grid"`
- [ ] **Step 6:** `npm run lint` (end of Stage 5) → clean.

---

## Stage 6 — Security audit & final verification

### Task 25: OWASP Top 10 (2025) audit pass

**Files:** Review-only (fix inline as needed). Audit every new endpoint/action against the spec §7 checklist.

- [ ] **Step 1: Access control (A01):** grep every new function in `admin-actions.ts` / admin-db usage and confirm `await requireAdmin()` is the first statement of each admin action. Confirm `stock_notifications` + `checkout_intents` have NO public RLS policies (`select * from pg_policies where tablename in (...)`). Confirm packing-slips has no public route.
- [ ] **Step 2: Cron auth (A04/A08):** confirm `/api/cron` rejects missing/invalid `CRON_SECRET` (401) and uses a constant-time compare; confirm no secret is logged.
- [ ] **Step 3: Injection/XSS (A03):** confirm note-answers, IG captions, review text, abandoned-cart items are HTML-escaped in all emails and any HTML render (reuse existing escaping helper). Confirm all queries are parameterized (no string-built SQL).
- [ ] **Step 4: Rate limiting (A04):** confirm `subscribeBackInStockAction`, `recordCheckoutIntentAction`, share/lookup endpoints are rate-limited.
- [ ] **Step 5: Data exposure (A01/A02):** fetch the wishlist-share + cart-share pages and inspect the network payload — assert NO email/phone/address/user_id leaks; only names/prices/slugs.
- [ ] **Step 6: Misconfig/SSRF (A05/A10):** confirm no server-side fetch of user-supplied URLs (IG is manual `<img src>` only); confirm CSP in `next.config.mjs` unchanged and the app still renders without CSP violations.
- [ ] **Step 7:** Document findings + fixes inline; `npx tsc --noEmit` + `npm run lint` clean. Commit — `git commit -am "chore(security): OWASP Top 10 (2025) audit pass"`

### Task 26: Full feature-toggle regression + memory update

- [ ] **Step 1:** For each of the 11 new flags: toggle OFF in Admin → Settings → Features, confirm the feature disappears from the storefront AND its server action refuses; toggle back ON, confirm restored. (Spot-verify via Playwright + DB, as done for the original 6 flags.)
- [ ] **Step 2:** Update memory (`project-michelles-munchies.md` + index if needed): record the 15 new features, the 11 flags, the new tables, the cron route + `CRON_SECRET`, and the new launch-config items (Vercel Cron schedule, `CRON_SECRET` env, `review-images` bucket).
- [ ] **Step 3:** Update `launch-config-checklist.md`: add Vercel Cron schedule (`vercel.json`), `CRON_SECRET` on Vercel, the `review-images` bucket (created), and "designate free-gift product / set caps / cutoff / note-prompts in admin".
- [ ] **Step 4:** Final `npx tsc --noEmit` + `npm run lint` + `npm run build` → all clean.

---

## Self-review notes

- **Spec coverage:** WS1 §5 → Tasks 5–6; WS2 → Tasks 7–12; WS3 → Tasks 13–17; WS4 → Tasks 18–20; WS5 → Tasks 21–24; cross-cutting flags → Tasks 3–4 + per-feature gates; OWASP §7 → Task 25; verification §8 → Task 26. All 15 features mapped.
- **No new test framework** — verification uses tsc/lint/Playwright/Supabase by design (see Conventions).
- **Idempotency** reused from points/referrals for stock decrement (Task 13) and birthday grant (Task 20).
- **Naming consistency:** flag camelCase keys (`buildABox`, `cartSharing`, …) ↔ `feature_*` snake columns are mapped in Tasks 3–4 and used unchanged thereafter.
