# Audit results, 7 August 2026

All 16 agents completed. Two arms ran.

**Arm one, the 43 leads left unverified when the previous run died.** Every one was
checked against current code: 26 confirmed, 3 refuted, 4 moot, 10 true but not worth fixing. The four moot ones are the four bugs fixed on
6 August, which is a useful sign the verifiers were reading the code as it stands.

**Arm two, the seven lenses that never executed.** 31 findings across 159 surfaces opened and judged fine.

Every finding below cites code that was read. All 31 fresh quotes were checked
mechanically against the real files and all 31 matched, so none of this is invented.
That proves the code was read, not that the reasoning is right.

Total to act on: **57**, of which 12 are high.


---

# HIGH

## Checkout promises "No payment is taken here" three times, then can send the customer to a Stripe payment page

- Where: `src/app/checkout/page.tsx:1118`
- Found by: verified lead
- Evidence: All three pieces of copy are hardcoded with no knowledge of the payment configuration. page.tsx:606 `{["Your details", "Confirm on WhatsApp", "Pay by PayNow"].map(...)}`. page.tsx:1117-1121 `No payment is taken here. Place your order, then send it to us on WhatsApp from the next page. We'll confirm it and reply with PayNow details so you can pay by transfer.` page.tsx:1150-1152 `You'll pay by PayNow after confirming on WhatsApp.` Against that, actions.ts:765 `checkoutUrl = await createCheckoutSession({...})`, payments.ts:22-23 `const stripe = getStripe(); if (!stripe) return null;`, stripe.ts:11-13 `const key = process.env.STRIPE_SECRET_KEY; if (!key) return null;`, actions.ts:779 `return { 
- Fix: Compute one boolean server-side from `getStripe() !== null` and seed it into the browser the way FeaturesProvider is already seeded from the root layout, then branch all three strings on it. With payments on, the steps read "Your details", "Pay securely", "We start baking", the summary box reads "You'll pay on the next page. PayNow and cards both work. Your order is confirmed the moment payment goes through, and we'll email you a link to follow it.", and the button subtext reads "Payment happens on the next page." With payments off, keep today's wording exactly. One correction to the lead's fix. actions.ts:772-774 swallows a Stripe session failure and falls back to `/track/...`, so even with payments on a customer can still land on the WhatsApp panel. That fallback is fine and the tracking page explains itself, so the new copy must not say payment is the only way to pay.

## Every product, bundle and box link pasted into WhatsApp shows the same generic bakery card, never the cake

- Where: `src/app/menu/[slug]/page.tsx:34`
- Found by: seo-metadata
- Evidence: return { title: product ? product.name : "Not found", description: product?.shortDescription, };
- Fix: In each generateMetadata, add an openGraph block alongside the title. For the product page: `openGraph: { title: product.name, description: product.shortDescription, type: "website", images: product.imageUrls?.length ? [product.imageUrls[0]] : ["/og.png"] }`. product.imageUrls already holds absolute Supabase Storage URLs (used directly by next/image at line 121), so they need no rewriting. Do the same in src/app/bundles/[slug]/page.tsx and src/app/build-a-box/[slug]/page.tsx, and consider per-page openGraph on /menu, /about and /contact so those three do not all share one card either.

## Menu page runs four independent reads strictly one after another

- Where: `src/app/menu/page.tsx:16`
- Found by: performance
- Evidence: const products = await fetchProducts(); const categories = Array.from(new Set(products.map((product) => product.category))); const settings = await fetchStoreSettings(); // Star lines on the cards, social proof where browsing actually happens. const ratings = settings.features.reviews ? await fetchAllRatings() : {};
- Fix: Await fetchStoreSettings first, then Promise.all the three independent chains: fetchProducts, the ratings read, and an async block that does getUser followed by the profiles select. The getUser to profiles pair is the only genuinely serial part, so the page drops from four round trips to two.

## Cancelling an order never re-pulls, so the menu keeps the sold-out state the cancel just undid

- Where: `src/components/admin/AdminStore.tsx:434`
- Found by: client-server-truth
- Evidence: async function cancelOrder(orderNumber: string) { const result = await cancelOrderAction(orderNumber); if (result.ok) { setOrders((prev) =>
- Fix: Await refresh() after a successful cancelOrderAction, the same way updatePaymentStatus does, before returning the result to the panel.

## Home page eagerly downloads every Instagram photo at full upload resolution

- Where: `src/components/content/InstagramGrid.tsx:43`
- Found by: performance
- Evidence: <img src={post.imageUrl} alt={post.caption ?? "Instagram post"} className="h-full w-full object-cover transition group-hover:scale-105" />
- Fix: Swap the img for next/image with fill inside the existing aspect-square wrapper and sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw". The Supabase host is already in remotePatterns, so this needs no config change and buys resizing, webp and lazy loading at once. If the raw img must stay for some other reason, add loading="lazy" and decoding="async" as the minimum.

## Filling the last slot in Build a Box disables the button under your finger and drops focus

- Where: `src/components/product/BoxBuilder.tsx:164`
- Found by: verified lead
- Evidence: BoxBuilder.tsx:164 is `disabled={choice.soldOut || remaining <= 0}` on the plus and line 154 is `disabled={qty === 0}` on the minus. `remaining` is derived at line 54 from the counts the button itself changes, so pressing plus on the final slot sets remaining to 0 and disables the very button that was pressed. Pressing minus down to zero does the same. A focused element that becomes disabled loses focus to document.body in Chrome and Safari. FlavourBoxPicker.tsx:146-153 carries a comment spelling out this exact trap, 'a button disabled under your finger drops focus to the page body', and fixes it at lines 158 and 169 with `aria-disabled={qty === 0}` and `disabled={soldOut} aria-disabled={rem
- Fix: Copy the sibling exactly. On line 164 keep `disabled={choice.soldOut}` and move the self-flipping half to `aria-disabled={remaining <= 0}`. On line 154 replace `disabled={qty === 0}` with `aria-disabled={qty === 0}`. Change both class strings from `disabled:opacity-40` to `disabled:opacity-40 aria-disabled:opacity-40`, matching FlavourBoxPicker.tsx:159 and 170. bump() already guards both cases so no handler change is needed. Also add the `role="status" aria-live="polite"` counter BoxBuilder already has at lines 102-111, which is fine as is, so the box filling up is still spoken.

## Star rating control on the review form is invisible until you have already rated

- Where: `src/components/product/ReviewForm.tsx:85`
- Found by: verified lead
- Evidence: Lines 83-89 render five ★ glyphs with `cn("text-2xl leading-none transition", (hover || rating) >= star ? "text-rose-deep" : "text-line")`, inside a form that is `rounded-2xl border border-line bg-white p-4` at line 68. globals.css:45 sets `--color-line: #f1dbe0`. I computed that against #ffffff: relative luminance 0.7476, contrast 1.32:1. WCAG 1.4.11 asks 3:1 for a user interface component, so this is off by more than half. On a fresh review initialRating is 0 and hover is 0, so all five stars are drawn at 1.32:1 and there is nothing to see. handleSubmit at lines 44-48 is `if (rating < 1) { setError("Please pick a star rating."); return; }`, so the form refuses to post until the customer fi
- Fix: Let the shape carry the state, not the colour. Render ☆ when `(hover || rating) < star` and ★ otherwise, and colour the unchosen glyph `text-muted`. --color-muted is #7c665f, which I measured at 5.35:1 on white, so the outline is plainly visible while staying soft. Make the same swap at Stars.tsx:13 so the empty half of a read-only rating is an outlined star rather than a near-white filled one. Do not simply darken the filled ★, because five dark filled stars read as a five-star rating already given.

## The escape hatch for a Stripe refund that will never succeed cannot be reached, so the order is trapped forever

- Where: `src/lib/admin-actions.ts:256`
- Found by: newest-code
- Evidence: export async function cancelOrderAction(orderNumber: string): Promise<CancelResult> { await requireAdmin(); return cancelAndRefundOrder(orderNumber); }
- Fix: Wire the hatch that is already written. Give cancelOrderAction a second parameter and pass it to cancelAndRefundOrder, keep refundFailed on the object AdminStore returns, and when the panel sees it show a second confirm along the lines of 'Stripe would not send this money back. Cancel the order anyway and send the money to the customer yourself?' then call cancel again with the flag set. If that is not wanted, delete cancelWithoutRefund, refundFailed and the comment, because right now they promise a way out that does not exist.

## The one refusal Michelle is allowed to override can never reach her, so a stuck order can never be cancelled

- Where: `src/lib/admin-actions.ts:256`
- Found by: client-server-truth
- Evidence: export async function cancelOrderAction(orderNumber: string): Promise<CancelResult> { await requireAdmin(); return cancelAndRefundOrder(orderNumber); }
- Fix: Give cancelOrderAction a second parameter for cancelWithoutRefund and pass it through. Carry refundFailed out through AdminStore.cancelOrder, and when it comes back true, offer her a second confirm that says the card refund will not go through and asks whether to cancel anyway and send the money back herself.

## Two flavour box sizes with the same count silently collapse into the first one, at its price and its name

- Where: `src/lib/boxes.ts:136`
- Found by: input-boundaries
- Evidence: const size = product.flavourBox.sizes.find((s) => s.count === count);
- Fix: Put the size's own identity in the cart key, for example `fbox::<productId>::<sizeLabel>::<count>::<labels>`, and resolve the size by that identity on the server instead of by count. Until that lands, refuse the product save when two sizes share a count, and have addBoxSize start a new size on a count that is not already taken.

## The rate limiter's Upstash fetch has no timeout, so a stalled Redis defeats the fallback that exists to stop exactly that

- Where: `src/lib/rate-limit.ts:61`
- Found by: verified lead
- Evidence: src/lib/rate-limit.ts:61-72 is `const res = await fetch(`${UPSTASH_URL}/pipeline`, { method: "POST", headers: {...}, body: JSON.stringify([...]), cache: "no-store" });` with no `signal`. Every other outbound fetch in src/lib carries one. `grep -rn "AbortSignal.timeout|signal:" src/lib/` returns only onemap.ts:18, :40 and :62. The protection the module advertises is at :98-105, `try { return await upstashAllow(...) } catch { console.error("[rate-limit] Upstash unavailable, using in-memory fallback:", error); }` under the comment on :102-103, 'Never let a Redis hiccup break a user action.' That path runs on a rejection only. Undici's default headers timeout is 300 seconds, far past any functio
- Fix: Add `signal: AbortSignal.timeout(2000)` to the fetch options at src/lib/rate-limit.ts:61-72, matching src/lib/onemap.ts. An abort rejects, so the existing catch at :101 and its console.error at :104 finally do what the comment promises and the request falls through to inMemoryAllow. Two seconds is generous for a Redis round trip from Vercel. No other change is needed, the fallback is already written and correct.

## The Stripe client sets no timeout, so a slow Stripe can hold checkout open long after the order is already committed

- Where: `src/lib/stripe.ts:13`
- Found by: verified lead
- Evidence: src/lib/stripe.ts:13 is exactly `if (!cached) cached = new Stripe(key);` with no options object. node_modules/stripe/package.json is version 22.2.0, and node_modules/stripe/cjs/stripe.core.js:98 has `const DEFAULT_TIMEOUT = 80000;` applied at :169, with `maxNetworkRetries` defaulting to 2 at :170. RequestSender.js:166 has `if (!res) return true;` in `_shouldRetry`, so a timeout produces no response and is retried, meaning a stalled call can occupy up to three 80 second attempts. The retries themselves are safe at Stripe because _defaultIdempotencyKey at RequestSender.js:216 auto-generates a key for retried POSTs, so the hazard is wall clock, not a duplicate session. The lead's supporting cla
- Fix: Give the Stripe client the bound the rest of the codebase already uses. Change src/lib/stripe.ts:13 to `cached = new Stripe(key, { timeout: 10_000, maxNetworkRetries: 1 });`. Ten seconds turns a stall into a fast throw that the existing catch at checkout/actions.ts:772 already handles by dropping the customer onto the PayNow tracking page with one real order behind them. Prefer maxNetworkRetries 1 over the default 2, because the worst case wall clock is the timeout multiplied by the attempts and 3 x 10s is still slower than any customer will wait. Note the lead slightly overstates one step. Even if the platform never kills the invocation, a customer on a phone will not sit through 80 seconds, so they reload or resubmit and the duplicate order happens anyway. The bound is what fixes it either way.


---

# MEDIUM

## Supabase's own developer English is shown verbatim on the sign-up and magic-link forms

- Where: `src/app/account/actions.ts:108`
- Found by: copy-voice
- Evidence: return { error: error.message };
- Fix: Replace with: return { error: "We couldn't create your account with those details. Check your email and password, then try again." }; and at line 171 use: return { error: "We couldn't send that link just now. Check your email address and try again." }; Keep the console/Sentry capture for the real message.

## The bake list counts orders that are already baked into the day's totals

- Where: `src/app/admin/(panel)/bake-list/page.tsx:20`
- Found by: verified lead
- Evidence: Lines 19-21 are the only filter: `const active = orders.filter((o) => o.status !== "completed" && o.status !== "cancelled");`. OrderStatus in src/lib/order.ts:145-152 is received, confirmed, baking, ready, out_for_delivery, completed, cancelled, so `ready` and `out_for_delivery` survive the filter. Their items are summed into the same per-label totals at lines 37-43 (`entry.qty += item.quantity`) and into `day.orderCount += 1` at line 35, which prints as "{day.orderCount} orders" at line 132. The page header at line 100 reads "Everything still to make, by day. Tick items off as you bake, they stay ticked." Ready means baked and boxed and out_for_delivery means it has left the kitchen. Two or
- Fix: Filter the bake list to statuses that still need an oven, so received, confirmed and baking. Keep the baked ones visible without counting them: under the date heading add a line built from the ready and out_for_delivery count, worded "3 orders already baked and waiting". Do not touch `windows`, which should still reflect every live order for that day so the bake order stays right.

## On a phone the orders table hides Status and Payment behind sideways scroll

- Where: `src/app/admin/(panel)/orders/page.tsx:199`
- Found by: verified lead
- Evidence: Line 199 is `<table className="w-full min-w-[760px] text-left text-sm">` with eight headers (lines 202-209), Status seventh and Payment eighth. Grepping the whole file for `sm:table-cell` returns nothing, so no cell is ever hidden and no column is sticky. The page content sits in AdminShell.tsx:259, `<main key={pathname} className="mx-auto max-w-6xl animate-[fade-up_0.3s_ease-out] px-5 py-8 lg:px-8">`, which leaves about 350px of the 760px table visible on a 390px phone. The dashboard's own recent-orders table already solves this at src/app/admin/(panel)/page.tsx:193-224 with `min-w-[560px]` plus `hidden ... sm:table-cell` on its Bake for and Payment cells. The lead's mention of a red deposi
- Fix: Copy the dashboard's pattern onto this table. Put `hidden sm:table-cell` on the Fulfilment and Ordered header cells (204, 205) and their matching body cells (233, 234-236), and drop the table to `min-w-[560px]`. Note the extra reason this matters here: nothing is sticky, so once she does swipe right the Order number and Customer columns scroll away and she cannot tell which row she is reading. If a bigger change is wanted, render each order as a card below `sm` with name, bake date and the two badges stacked.

## A blank price box saves the treat at S$0.00 with no guard

- Where: `src/app/admin/(panel)/products/page.tsx:355`
- Found by: input-boundaries
- Evidence: const cents = Math.max(0, Math.round(parseFloat(priceText || "0") * 100));
- Fix: Parse once, guard with Number.isFinite, and refuse the save with a plain line when the price is not a number above zero, in the same block that already refuses a bad slug. Do the same for the cost field, which is nullable in the database and so writes NaN through as a silent null.

## Pausing or deleting a promo code can silently do nothing and leave the row unusable

- Where: `src/app/admin/(panel)/promos/page.tsx:83`
- Found by: verified lead
- Evidence: Lines 83-90 are `async function toggleActive(promo) { setBusyId(promo.id); await setPromoActiveAction(promo.id, !promo.active); setPromos(...); setBusyId(null); }` with no try/catch or finally, and remove at 92-98 has the identical shape. src/lib/admin-actions.ts:458-461 is `export async function setPromoActiveAction(id, active): Promise<void> { await requireAdmin(); await setPromoActive(id, active); }`, and setPromoActive at src/lib/admin-db.ts:1648-1652 does `if (error) throw new Error(\`Failed to update promo code: ${error.message}\`);`. So a rejection skips the local flip and skips `setBusyId(null)`. The row then keeps the badge it had, which at line 242 still reads "Active", and both bu
- Fix: Wrap both handlers in try/catch/finally so busyId always clears in the finally, and move the local flip so it only runs after the action resolves. Add a per-row error state, `rowError: { id, message }`, and render it next to the row's buttons. Copy for the pause failure: "That did not save. The code is still active. Please try again." For delete: "That code is still there. Please try again."

## Michelle is told to add credentials that exist only as Vercel environment variables, with an em dash

- Where: `src/app/admin/(panel)/settings/page.tsx:834`
- Found by: copy-voice
- Evidence: Not located yet — add your OneMap credentials, then save again.
- Fix: Replace line 834 with: "Not on the map yet, so delivery stays on the flat fee above. The map lookup still needs to be switched on." And at line 736 split the colon into two sentences: "The flat delivery fee above stays the fallback. It is used until zones are set up here, or whenever an address can't be located."

## Cart minus button deletes the line at quantity one, with no warning and nothing announced

- Where: `src/app/cart/page.tsx:148`
- Found by: verified lead
- Evidence: cart/page.tsx lines 145-152 are exactly as claimed: `aria-label={`Decrease quantity of ${item.name}`}` with `onClick={() => updateQuantity(item.key, item.quantity - 1)}` and no floor. CartContext.tsx lines 66-72 confirm the sink: `setItems((prev) => quantity <= 0 ? prev.filter((i) => i.key !== key) : prev.map(...))`. So at quantity 1 the press deletes the line. There is no confirm step and no undo anywhere in the cart, `removeItem` at CartContext.tsx:74 is a bare filter. Two things make this worse than the hunter said. First, the same codebase already floors this exact control on the product page, OptionPicker.tsx:238 reads `onClick={() => setQuantity((q) => Math.max(1, q - 1))}`, so the car
- Fix: Floor the decrease in the cart so it cannot delete, `updateQuantity(item.key, Math.max(1, item.quantity - 1))`, and leave deleting to the Remove button that says Remove. A floor alone makes the press a silent no-op at one, so also mark that button `aria-disabled={item.quantity === 1}` and style it with `aria-disabled:opacity-40`. Use aria-disabled and not the real `disabled` attribute, for the reason already written into FlavourBoxPicker.tsx:146-153, a button disabled under your finger drops focus to the page body. Then add the announcement the page is missing, a single `<span className="sr-only" role="status" aria-live="polite">` near the list holding the last removal, worded "Removed Ondeh Ondeh Cake from your cart." and cleared after. MenuBrowser.tsx:276 and ProductCard.tsx:168 already use that exact sr-only status pattern, so follow them. Move focus to the cart heading after a removal so a keyboard user is not dropped on document.body.

## Remove is a 20px-tall unpadded text button that deletes a line for good, and the cart steppers are 32px

- Where: `src/app/cart/page.tsx:173`
- Found by: verified lead
- Evidence: Every size claim holds. cart/page.tsx:149 and :164 are `flex h-8 w-8 items-center justify-center rounded-full`, so 32px squares. cart/page.tsx:173 is `text-sm font-semibold text-muted transition hover:text-rose-deep` with no padding at all. I checked whether anything gives it back: globals.css imports Tailwind v4 at line 1, and its `@layer base` block (lines 71-110) sets html, body, headings and the focus ring only, nothing touches button padding, so preflight's `padding: 0` on button stands. `text-sm` is 14px on a 20px line box, so Remove really is a roughly 20px by 57px target, and cart/page.tsx:172 fires `removeItem(item.key)` with no confirm and no undo. The repeats are real too, BoxBuil
- Fix: Give Remove a real target first, that is the part that matters. `-mr-2 rounded-full px-3 py-2.5 text-sm font-semibold text-muted transition hover:text-rose-deep` puts it at 40px tall with the negative margin holding it flush to the card edge, so nothing moves visually. Then take the two cart steppers to `h-11 w-11` and widen the value span from `w-8` to `w-10` so the pill stays balanced, it fits, the content column is about 215px on a 375px phone and the pill grows to 128px. For BoxBuilder and FlavourBoxPicker prefer `h-10 w-10` and check the rows after, those grids run up to a dozen items and 44px adds real height to every row. Pair this with the quantity floor from lead 1, a bigger Remove button matters less if the minus can still delete.

## The cart lets a customer build a quantity checkout will always refuse, then names neither the treat nor the limit

- Where: `src/app/checkout/actions.ts:460`
- Found by: input-boundaries
- Evidence: if (items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 99)) {
- Fix: Cap both steppers at 99 so the cart can never hold a quantity checkout refuses, and change the server line to name the treat and the number, for example "We can only take 99 of Vanilla Cupcakes on one order. Please lower that line or message us for a bigger batch."

## Checkout re-fetches settings from the browser after hydration and blocks the time picker on it

- Where: `src/app/checkout/page.tsx:175`
- Found by: performance
- Evidence: const r = await fetchClientSettingsRow().catch(() => null); if (!active) return; if (r) {
- Fix: Turn the route into a thin server component that awaits fetchStoreSettings and passes the fields it needs as props to a renamed CheckoutForm client component. The form keeps its current behaviour, it just starts with real values instead of defaults plus a pending read, so settingsLoaded can start true and the placeholder goes away. The layout already does exactly this for feature flags through SiteChrome.

## The FAQ promises a reschedule window that the app closes for exactly the reason the FAQ gives

- Where: `src/app/contact/page.tsx:43`
- Found by: copy-voice
- Evidence: a: "You can reschedule your date and time yourself from your order tracking page while the order is still being prepared. For anything else, message us as early as possible and we'll do our best to help.",
- Fix: Replace the answer with: "You can move your date and time yourself on your order tracking page, right up until we confirm the order. After that, or if your date is close, message us and we will sort it out."

## Deep rose text on the blush notice panels sits at about 4.0 to 4.4 to 1, under AA, on the notices that carry lead time, free delivery, fully booked and ordering paused

- Where: `src/app/globals.css:40`
- Found by: verified lead
- Evidence: The token is real and the comment does only vouch for it as a background. globals.css:40 — `--color-rose-deep: #bc4a6a; /* CTA buttons, deepened candy rose (white text passes AA) */`. globals.css:38 — `--color-blush-soft: #ffe3e8;`. I recomputed the ratios rather than trusting the lead. #bc4a6a on #ffe3e8 is 4.02:1. On blush-soft/60 blended over cream it is 4.25:1, on blush-soft/50 about 4.4:1. All under the 4.5:1 that 14px and 12px text needs, at any weight, since font-semibold at 14px is still normal text for WCAG. Every cited pairing exists, all at text-sm or text-xs: - src/app/cart/page.tsx:189 `bg-blush-soft/60 ... text-sm text-rose-deep`, the free-delivery nudge - src/app/menu/[slug]/p
- Fix: Add one token beside the others in the @theme block in globals.css, `--color-rose-ink: #a33a56`, and switch the text-on-blush and text-on-marble uses to text-rose-ink. I checked the numbers: 5.28:1 on blush-soft, 6.37:1 on white, 6.04:1 on cream. Same hue family, so the panels still read as candy rose. Leave --color-rose-deep alone. White on it is 4.85:1, so every button, border and focus ring that uses it as a background still passes and none of them should change. Two things the lead's fix misses. Drop the /80 and /90 opacity suffixes at gift/[token]/page.tsx:66, track/[token]/page.tsx:413 and account/page.tsx:138 rather than carrying them over to the new token, because faded text on a tinted panel is what pushed those to 3.1:1 in the first place. And include the eight extra spots listed above, otherwise half the notices stay at 4.0:1 and the shop ends up with two different pinks side by side.

## Safari prints only the first page of a bake sheet and drops the rest

- Where: `src/app/globals.css:348`
- Found by: safari-ios
- Evidence: body:has(.print-only-target) .print-only-target { position: absolute; left: 0; top: 0; width: 100%; }
- Fix: Keep the visibility trick but stop taking the target out of flow. Instead of position absolute, hide the siblings with display none inside the print block and let the target print in normal flow, or wrap the printable section so only its ancestors collapse. Normal flow is what lets WebKit paginate.

## No loading state anywhere on the storefront, so every tap on a menu card, order link or account page leaves the old page sitting there while the server queries Supabase

- Where: `src/app/layout.tsx:11`
- Found by: verified lead
- Evidence: Every part of the claim held up when I opened the files. src/app/layout.tsx:11 — `export const dynamic = "force-dynamic";` with the comment above it explaining the CSP nonce reason, so this is deliberate and not going away. `find src/app -name loading.tsx -o -name template.tsx` returns nothing. The only match in that whole search is `src/app/not-found.tsx`. There is no loading.tsx and no template.tsx under src/app at all. The only three Suspense uses in the codebase are account/sign-in/page.tsx:176, account/forgot/page.tsx:93 and account/reset/page.tsx:124, and all three are `<Suspense fallback={null}>` wrapping the useSearchParams shell. Not data boundaries. Grepping the whole of src for us
- Fix: Add a loading.tsx next to the four heavy routes: src/app/menu, src/app/menu/[slug], src/app/account and src/app/track/[token]. Shape each one like the page it stands in for so nothing jumps when the real content lands. For /menu that is the h1 line, the filter strip and a grid of card skeletons at ProductCard's aspect. For /track/[token] and /account a single panel is enough. One correction to the lead's fix. Do not reuse src/components/admin/PanelLoading.tsx as-is for the card grid, because a centred mascot with `py-24` under a full-width heading collapses the page height and then snaps back. Use it only for the single-panel routes, /track/[token] and /account, where its shape already matches. Lift it to src/components/ui/ if it is going to serve both sides. Worth knowing, because it doubles the payoff: with no loading.tsx a dynamic route has nothing for Next to prefetch on a Link, so the first byte only starts moving on tap. Adding the boundary gives the prefetch something to cache, so the skeleton is already there when the finger lands.

## No canonical URL on any page, so every tracking-tagged link is a separate URL to Google

- Where: `src/app/layout.tsx:41`
- Found by: seo-metadata
- Evidence: export const metadata: Metadata = { metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"), title: { default: "Michelle's Munchies · Freshly baked to order", template: "%s · Michelle's Munchies", },
- Fix: Add `alternates: { canonical: "/" }` to the root metadata in this file so unspecified routes resolve against metadataBase, then set the real path on each public route, for example `alternates: { canonical: `/menu/${product.slug}` }` inside the product generateMetadata and `alternates: { canonical: "/menu" }` on the menu page.

## Google is told an exact price the page itself calls a starting price

- Where: `src/app/menu/[slug]/page.tsx:88`
- Found by: seo-metadata
- Evidence: offers: { "@type": "Offer", priceCurrency: "SGD", price: (product.basePriceCents / 100).toFixed(2),
- Fix: When product.options.length > 0, emit an AggregateOffer instead of a flat Offer: `"@type": "AggregateOffer", priceCurrency: "SGD", lowPrice: (basePriceCents/100).toFixed(2), highPrice: computed from the maximum reachable option deltas, offerCount: ...`. Keep the plain Offer only for products with no options. That matches what the page already shows.

## The sitemap lists no bundle or box page, so the gift-oriented pages are the least discoverable

- Where: `src/app/sitemap.xml/route.ts:24`
- Found by: seo-metadata
- Evidence: ...products.map((product) => ({ loc: `${SITE_URL}/menu/${product.slug}`, priority: "0.6", })),
- Fix: Import fetchActiveBundles from @/lib/bundles and fetchActiveBoxTemplates from @/lib/boxes, and when the matching feature flag is on, map each into an entry at the same priority as products, for example `${SITE_URL}/bundles/${bundle.slug}` and `${SITE_URL}/build-a-box/${box.slug}`. Both helpers already return only active rows.

## Referral code a friend has to retype is set in Michelle's handwriting font

- Where: `src/components/account/ReferralCard.tsx:37`
- Found by: verified lead
- Evidence: Line 37 is `<span className="rounded-xl border border-line bg-white px-4 py-2 font-display text-lg font-semibold tracking-[0.2em] text-ink">{code}</span>`, and it is the only place the code is drawn. The Copy button at line 40 copies a URL, not the code, so reading it off the screen is the only other way to pass it on. globals.css:17 sets `--font-display: var(--font-michelle), var(--font-fraunces)`, so this is the handwriting face. I parsed src/app/fonts/Michelle-Regular.ttf: numGlyphs 82, and its cmap covers 0-9 and A-Z in full, so there is no per-glyph fallback to Fraunces. The whole code renders in the script. The code is `upper(substr(md5((random())::text), 1, 6))` at supabase/migrations
- Fix: Drop `font-display` from ReferralCard.tsx:37 and keep everything else, so the line reads `"rounded-xl border border-line bg-white px-4 py-2 text-lg font-semibold tracking-[0.2em] text-ink"`. Leave checkout/page.tsx:927 alone. I opened it and it is `<span className="block font-display text-xl font-semibold text-ink">🎁 Send as a gift</span>`, a section heading, which is exactly where the brief puts the handwriting. account/page.tsx:130 is the points balance in font-display text-3xl. That one is a judgement call and much weaker than the referral code, since nobody transcribes their own points, so leave it unless the owner wants it changed.

## Share my wishlist cannot reach the clipboard in Safari because the tap has already been spent

- Where: `src/components/account/ShareWishlistButton.tsx:25`
- Found by: safari-ios
- Evidence: setStatus("loading"); const result = await getWishlistShareLinkAction(); if (!result.ok) { setStatus("error"); setMessage(result.error); return; } try { await navigator.clipboard.writeText(result.url);
- Fix: Fetch the link before the copy needs it, or hand Safari the promise instead of the result. navigator.clipboard.write with a ClipboardItem whose text/plain value is the pending promise is supported in Safari for exactly this case, and it keeps the write attached to the original tap.

## The cancel writes a refund row the panel never hears about, so her money figures are wrong on screen

- Where: `src/components/admin/AdminStore.tsx:437`
- Found by: newest-code
- Evidence: setOrders((prev) => prev.map((o) => o.orderNumber === orderNumber ? { ...o, status: "cancelled", paymentStatus: result.refunded ? "refunded" : o.paymentStatus, } : o, ), );
- Fix: Pull fresh data once the server answers, the same way addManualOrder does. Add `await refresh();` inside the `if (result.ok)` block after the local patch. The cancel result carries the order total, not the amount refunded, so a refresh is the only honest way to get the real number.

## Admin price and option fields drop back to 14px because text-sm outranks text-base

- Where: `src/components/admin/NewOrderModal.tsx:334`
- Found by: safari-ios
- Evidence: className={cn(inputClass, "w-28 text-sm")}
- Fix: Drop the trailing text-sm from both class strings and let compactInputClass supply the size. If a smaller field really is wanted on desktop, add sm:text-sm instead, which only applies from 640px up.

## Allergen tooltip on a menu card is clipped by the card's overflow-hidden

- Where: `src/components/product/AllergenChips.tsx:48`
- Found by: verified lead
- Evidence: AllergenChips.tsx:48 is `"pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-xs font-semibold text-white opacity-0 transition-opacity group-hover/chip:opacity-100 group-focus-within/chip:opacity-100"`. Its containing block is the `li` at line 34, which is `group/chip relative`, and that li is a descendant of ProductCard.tsx:69 `<article className="group relative flex h-full flex-col overflow-hidden ...">`, so the article clips it. The chips render at ProductCard.tsx:114 inside `<div className="flex items-start justify-between gap-2">`, hard against the right edge of the p-4 content box. At 390px the rail card is bas
- Fix: Do not move `overflow-hidden` off the article as the lead proposes. That is what rounds the top of the card: the image wrapper at ProductCard.tsx:77 is `relative aspect-square w-full overflow-hidden` with no radius, and the no-photo branch at line 87 passes `rounded-none border-0` to ImagePlaceholder, so both would poke square corners outside the rounded-2xl border. The clean minimal fix is to anchor the tooltip from its own right edge, swapping `left-1/2 -translate-x-1/2` for `right-0` at AllergenChips.tsx:48, which makes the bubble grow leftward into the card and never reach the border. Better on the card itself, drop the popup for the grid and print the words under the description as `text-xs text-muted`, reading `Contains peanuts, dairy`. Allergen text should not need a tap. Also worth noting the chip is h-7 w-7, 28px, which is a small target for health-critical information.

## Back-in-stock email field and review textarea are 14px, so iOS Safari zooms the page on focus

- Where: `src/components/product/NotifyBackInStock.tsx:83`
- Found by: verified lead
- Evidence: NotifyBackInStock.tsx:83 is `className="flex-1 rounded-xl border border-line bg-white px-3 py-2 text-sm focus:border-rose"`, an explicit 0.875rem with no sm: reset. ReviewForm.tsx:97 is `className="mt-3 min-h-20 w-full resize-y rounded-xl border border-line bg-white px-3 py-2 text-sm transition focus:border-rose"`, same problem. iOS Safari zooms the viewport whenever a focused form control computes under 16px, and it does not zoom back out on blur. The project already knows this. src/lib/ui.ts:8-10 reads `/** Compact input, admin panel forms. 16px on phones so iOS Safari never zooms on focus. */` over `compactInputClass` which is `... px-3 py-2 text-base focus:border-rose sm:text-sm`, and Me
- Fix: Change `text-sm` to `text-base sm:text-sm` at NotifyBackInStock.tsx:83 and at ReviewForm.tsx:97. Nothing changes at 640px and above, and it matches compactInputClass in src/lib/ui.ts. Do not add a maximum-scale=1 viewport meta as an alternative, since that blocks pinch zoom for everyone.

## Review box is 14px, so iOS Safari zooms the page and never zooms back

- Where: `src/components/product/ReviewForm.tsx:97`
- Found by: safari-ios
- Evidence: className="mt-3 min-h-20 w-full resize-y rounded-xl border border-line bg-white px-3 py-2 text-sm transition focus:border-rose"
- Fix: Give both controls text-base sm:text-sm, matching compactInputClass in src/lib/ui.ts. That keeps 16px on phones and the smaller size from 640px up, where no zoom rule applies.

## The tracking page change panel goes permanently dead when a request drops

- Where: `src/components/track/OrderChangePanel.tsx:34`
- Found by: verified lead
- Evidence: Read the whole file. Lines 31-42 are exactly as claimed, no try/catch anywhere: async function reschedule() { setBusy(true); setMessage(null); const result = await rescheduleOrderAction(token, date, window); setBusy(false); requestCancel at lines 44-55 has the same shape, with `const result = await requestCancellationAction(token);` on line 48 and `setBusy(false);` on line 49. If either promise rejects, execution leaves the function before setBusy(false) and before setMessage, so `busy` stays true and nothing is written to the message region on line 85. An unhandled rejection in an async onClick handler is not caught by a React error boundary or error.tsx, so the screen says nothing at all. 
- Fix: In OrderChangePanel, wrap each action call so a rejection is handled rather than lost. Follow the shape checkout already uses rather than inventing a second one, so `const result = await rescheduleOrderAction(token, date, window).catch(() => null);` then `setBusy(false);` then `if (!result) { setMessage({ kind: "error", text: "We couldn't send that just now. Please check your connection and try again." }); return; }`. Same for requestCancellationAction on line 48. Give the Save button a busy label to match its neighbours, `{busy ? "Saving..." : "Save new date"}` on line 101. Keep the wording non-committal, because a lost response can mean the change did land. That matters more here than at checkout. rescheduleOrderAction increments reschedule_count and MAX_RESCHEDULES is 3, so a customer who retries after a lost response silently burns one of their three moves. Do not write copy that claims the change did not happen. Apply the same catch to the three other files. Their labels are already correct, so they only need the catch plus an error message set on rejection. All proposed copy is voice checked, no em dashes, no semicolons, no mid-prose colons, no parentheticals.

## The mascot ships a 512 pixel image into a 96 pixel box, and preloads it

- Where: `src/components/ui/MascotSays.tsx:54`
- Found by: performance
- Evidence: width={512} height={512} priority={priority} className={cn(size === "hero" ? "h-24 w-24 animate-float" : "h-16 w-16")}
- Fix: Pass the real display size. width 96 and height 96 for the hero variant, 64 for the quiet one, which makes next/image emit a 96w and 256w srcset and cuts the download to a few kilobytes. Same change at SiteHeader.tsx line 30 with width and height of 56. If a single declared size is preferred, keep 512 but add sizes="96px" so the browser picks from the full width list instead of the two density entries.

## When the order update fails after the money has already gone back, she is handed a raw database error and no warning

- Where: `src/lib/admin-db.ts:840`
- Found by: newest-code
- Evidence: if (updErr) return { ok: false, error: updErr.message };
- Fix: Say it in her words and keep the database text for the console and Sentry. When refunded is true, something like `The ${formatPrice(outstandingCents)} refund went back to the customer, but the order could not be marked cancelled. Open it and cancel it once more. No money will move a second time.` That is true, because the retry reads the refund total as the full amount, takes the outstandingCents === 0 branch and makes no Stripe call. When refunded is false, a plain 'The order could not be cancelled. Please try again in a moment.' is enough.

## The order discount is dropped on the way to the browser, so Insights overstates profit on every promo order

- Where: `src/lib/admin-db.ts:104`
- Found by: client-server-truth
- Evidence: paidAt: row.paid_at, refundedCents: (row.order_refunds ?? []).reduce((sum, r) => sum + r.amount_cents, 0), subtotalCents: row.subtotal_cents, deliveryFeeCents: row.delivery_fee_cents, totalCents: row.total_cents,
- Fix: Map discount_cents onto AdminOrder in rowToAdminOrder, subtract it from the seller revenue and profit totals in the Insights fold, and show a discount line between the items and the Total in the order detail.

## No List-Unsubscribe header on the five marketing sends, so the only opt-out is a footer link and Report Spam is the easier tap

- Where: `src/lib/email.ts:207`
- Found by: verified lead
- Evidence: Line 207 is `resend.emails.send({ from: FROM, to, subject, html })` and it is the only send call in the codebase. The installed SDK does accept the missing fields, `node_modules/resend/dist/index.d.mts` line 550 `headers?: Record<string, string>` and line 556 `replyTo?: string | string[]` on CreateEmailBaseOptions. Five sends are marketing and already carry a working opt-out URL, `marketingFooter` at line 149 links `${SITE_URL}/unsubscribe/marketing/${optOutToken}` for winback, occasion, birthday and abandoned cart, and `sendNewsletterEmail` at line 557 builds `${SITE_URL}/unsubscribe?token=${unsubscribeToken}`. The tokens are real at the call sites, `src/lib/winback.ts:106` passes optOutTok
- Fix: Widen `send()` to take optional headers and set `List-Unsubscribe: <url>` on the five marketing sends only, using the token each already holds. Use the marketing opt-out URL for winback, occasion, birthday and abandoned cart, and the newsletter URL for the newsletter, because they are two different lists on two different routes. Skip the header when the token is absent and for the `test-preview` token at src/lib/newsletter-actions.ts:109. Correcting the lead: do not add `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Both routes are GET-only pages, `src/app/unsubscribe/page.tsx` and `src/app/unsubscribe/marketing/[token]/page.tsx`, each rendering a confirm component. A one-click POST would get a 405 and the customer would watch their unsubscribe fail, which is worse than today. One-click needs a POST route handler written first. The missing plain-text part is optional polish, not the finding. HTML-only scores very lightly in modern filters and the claimed spam-folder outcome for order confirmations is speculative.

## Status subjects open with 26 characters of order number, so a phone inbox shows six identical-looking emails

- Where: `src/lib/email.ts:320`
- Found by: verified lead
- Evidence: Line 320 is `return send(params.email, \`Order ${params.orderNumber}: ${label}\`, ...)`. `generateOrderNumber` at src/lib/order.ts:92 returns `MM-${yy}${mm}${dd}-${random}` with `randomBase36(8)`, so 18 characters. That makes the fixed prefix 26 characters, not the 24 the lead claims. `orderStatusLabels` at src/lib/order.ts:167 supplies the one word that matters, and it lands last. The shape repeats at line 341 `Order ${params.orderNumber}: cancelled`, line 361 `Order ${params.orderNumber}: new date`, and line 485 `Order ${params.orderNumber}: your gift still needs delivery details`. What makes this a defect rather than taste is that the same file already does it correctly. Line 281 sends `W
- Fix: Front-load the news and keep the order number trailing, matching line 281. Add a subject map beside `statusLines` at line 297, with `received` as "Your order is in the bake book", `confirmed` as "Your order is confirmed", `baking` as "Your treats are in the oven", `ready` as "Your order is ready", `out_for_delivery` as "Your order is on its way" and `completed` as "Thanks for ordering". Set line 341 to "Your order is cancelled", line 361 to "We moved your order to a new date" and line 485 to "Your gift still needs a delivery address". Append the order number after a comma in each. Correcting the lead, do not drop the number from the subject. Michelle quotes it on WhatsApp, and a customer with two live orders needs to tell them apart. Trailing is enough.

## A newsletter send keeps no record of who received it, so an interrupted send leaves Michelle told to check something that does not exist

- Where: `src/lib/newsletter-actions.ts:83`
- Found by: verified lead
- Evidence: src/lib/newsletter-actions.ts:83-92 is `for (const sub of subscribers) { if (suppressed.has(...)) continue; const delivered = await sendNewsletterEmail(...); if (delivered) sent += 1; }`, awaiting one send at a time and writing nothing per recipient. The only output is the in-memory `sent`, returned at :93. src/lib/newsletter.ts:96-107 shows listActiveSubscribers applies no limit. src/lib/email.ts:165 sets `const MIN_SEND_GAP_MS = 600;` and queueSend at :171-182 enforces it across all sends, so the loop cannot beat roughly 1.6 emails a second. `grep -rn maxDuration` across the repo returns nothing, so the send runs at the platform default. The consequence is on screen in src/app/admin/(panel
- Fix: The lead's fix is right in shape but too vague to build from, because 'this campaign' has no identity in the current schema. Concretely, add `last_newsletter_at timestamptz` and `last_newsletter_subject text` to newsletter_subscribers. In the loop at newsletter-actions.ts:85-91, stamp both on the subscriber the moment sendNewsletterEmail returns true. At the top of sendNewsletterAction, skip any subscriber already stamped with this same trimmed subject in the last 24 hours. A run that gets cut short then resumes where it stopped instead of starting over. Then change the copy so it stops asking her to check something invisible. Something like 'Sending stopped partway. Send again to finish, no one gets it twice.' That wording obeys the voice rules and is only true once the stamping above exists, so ship them together.

## Backing out of the Stripe payment page returns the customer to a blank checkout form while their order already exists

- Where: `src/lib/payments.ts:75`
- Found by: verified lead
- Evidence: payments.ts:74-75 `success_url: `${siteUrl}/track/${input.trackingToken}`, cancel_url: `${siteUrl}/checkout`,`. The order is already committed before Stripe is reached, actions.ts:703 `created = await createOrder({...})`, and the session is only built afterwards at actions.ts:765. I read the whole of checkout/page.tsx and there is no recovery path. Every field starts empty, `useState("")` for name, email, phone, line1, unit, postalCode, giftMessage, recipientName, recipientPhone, and `useState({})` for noteAnswers, with no read of any marker or pending order anywhere in the file. The cart does survive, and deliberately so, ClearCartOnMount.tsx:6-9 says "Placed here instead of at checkout sub
- Fix: Change cancel_url to `${siteUrl}/track/${input.trackingToken}` so a cancelled payment lands on the order that already exists. The tracking page already renders the order and, while payment_status is not paid, the "One more step" WhatsApp and PayNow panel at track/[token]/page.tsx:189-205, and ClearCartOnMount will clear the cart there because checkout set the mm-order-placed marker before redirecting, which is correct once the order exists. Correct one thing in the lead's fix. There is no "Pay now" button to add beside that panel and no way to resume a cancelled session, since a Checkout Session URL is single use and expires. A real pay button needs a new server action that mints a fresh session for that order number, which is a separate piece of work. The one-line cancel_url change plus a sentence on the tracking page saying "Your order is saved and nothing has been charged yet" removes the duplicate-order risk on its own.


---

# LOW

## The bake list never separates days that have already gone by

- Where: `src/app/admin/(panel)/bake-list/page.tsx:50`
- Found by: verified lead
- Evidence: Line 49-50 is `return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])) // soonest first` with no date floor, so the oldest date renders first. Both sibling prep screens do floor: packing-slips/page.tsx:29-31 filters `o.status !== "cancelled" && o.status !== "completed" && o.scheduledDate >= today` and shopping-list/page.tsx:64-66 filters `o.status !== "cancelled" && o.scheduledDate >= today`. Stale orders really do survive: src/lib/order-cleanup.ts only cancels rows that are `.eq("status", "received")`, unpaid, with no owner note, `reschedule_count` 0, no PaymentIntent and `updated_at` still equal to `created_at`, so a paid order left in ready or completed-by-hand-never sits fo
- Fix: Keep past days, because a paid order whose date slipped does still need baking, but stop them sorting above today's work. Split the array on `date >= singaporeDateString()` and render the past ones in their own group below, headed "Overdue", with one line under the date reading "This day has already gone by. Move the order to a new date or mark it done." Do not apply the flat `scheduledDate >= today` filter the other two screens use, since that would silently hide real work she has been paid for. Note the module currently uses `toISODate(new Date())` at line 62 rather than the Singapore date helper, so use `singaporeDateString()` for the cut.

## The earliest bookable date is frozen at page load, so a checkout left open across the date rollover dead-ends the customer

- Where: `src/app/checkout/page.tsx:120`
- Found by: verified lead
- Evidence: page.tsx:120-123 `const earliest = useMemo(() => earliestFulfillmentDate(settings.leadTimeDays, singaporeNow(), settings.dailyCutoffTime), [settings.leadTimeDays, settings.dailyCutoffTime]);`. singaporeNow() is evaluated inside the memo, so after the settings effect replaces the object once the value never moves again. page.tsx:126 `const [date, setDate] = useState(earliest)`, so the preselected date is that frozen value. page.tsx:474 compares against the same stale value and passes, page.tsx:753 uses it as `min`, page.tsx:728 prints "We bake to order. The earliest date is {earliest}." The server recomputes fresh at actions.ts:550-557 and returns "Please choose a later date. We bake to order
- Fix: Two changes, and the second matters more than the first. Hold `earliest` in state and refresh it from singaporeNow() on a one-minute interval, pushing `date` forward when it moves, with a line by the date field saying "The date rolled over, so we've moved your order to Sat, 9 Aug 2026." Then key the server's date refusal to the date field instead of `errors.order`, so when placeOrder answers "Please choose a later date. We bake to order." the words land next to the control that has to change rather than in the summary beside the button. The lead's suggestion to pass a live value into CutoffBanner is sound but inert today, since no cutoff time is set.

## A failed checkout focuses an error that is not the topmost one, scrolling past errors above it

- Where: `src/app/checkout/page.tsx:521`
- Found by: verified lead
- Evidence: page.tsx:519-523 `if (Object.keys(found).length > 0) { const firstId = Object.keys(found)[0]; document.getElementById(firstId)?.focus(); return; }`. validate() inserts in this order, page.tsx:470-509, name, email, phone, date, timeWindow, line1, postalCode, recipientName, recipientPhone, note-<id>, order. The DOM order is different, fulfillment first, then the delivery address section with line1 and postalCode at page.tsx:687-722, then the schedule with date and timeWindow at page.tsx:725-820, then Your details with name, email and phone at page.tsx:823-853. So a delivery customer with a blank name and a five-digit postal code is focused on Name, which sits below both, and .focus() scrolls i
- Fix: Sort before focusing. Collect the ids in `found` that resolve to a real element, order them with compareDocumentPosition, and focus the first one, so the customer always lands on the topmost problem. Two corrections to the lead. `order` is one of the keys validate() can set and there is no element with that id, so `?.focus()` is already a silent no-op there, which is fine because the minimum-order message renders in the summary right above the button they just tapped, so skip it deliberately rather than by accident. The secondary point about `<p id="timeWindow">` under `<label htmlFor="timeWindow">` at page.tsx:758-784 is true but has no live consequence, the paused branch blocks submit at page.tsx:516, the gift self-schedule branch is skipped by validate() at page.tsx:479, and the loading branch is gone within milliseconds. Leave it alone or fix it for tidiness, not as part of this.

## Checkout's date error carries a parenthetical aside that repeats the line directly above it

- Where: `src/app/checkout/page.tsx:475`
- Found by: copy-voice
- Evidence: next.date = `Earliest available is ${formatLongDate(earliest)} (we bake to order).`;
- Fix: Use the same shape as the server copy in checkout/actions.ts:556. Replace both line 475 and line 743 with: `We bake to order, so the earliest date is ${formatLongDate(earliest)}.`

## The email confirmation page prints the bakery name twice in the browser tab

- Where: `src/app/confirm/[token]/page.tsx:7`
- Found by: seo-metadata
- Evidence: export const metadata: Metadata = { title: "Confirm your email · Michelle's Munchies", robots: { index: false }, };
- Fix: Change the title to just `"Confirm your email"` and let the root template add the brand, matching what /gift/[token], /track/[token] and /unsubscribe already do.

## Home page chains three Supabase reads that could overlap

- Where: `src/app/page.tsx:46`
- Found by: performance
- Evidence: const featured = await fetchFeatured(8); const settings = await fetchStoreSettings(); const reviews = settings.features.reviews ? await fetchReviewHighlights() : { avg: 0, count: 0, quotes: [] };
- Fix: Read settings first, then Promise.all the featured rail and the review highlights, keeping the same features.reviews gate on the second one. That takes the home page from three serial reads to two.

## Try again on the admin error banner looks broken when the retry also fails

- Where: `src/components/admin/AdminShell.tsx:247`
- Found by: newest-code
- Evidence: {!hydrated && ( <button type="button" onClick={() => void refresh()}
- Fix: Give the tap something to show. Track a retrying flag in the provider, swap the label to 'Trying...' and disable the button while the load is in flight, then on a second failure word it as a fresh attempt, for example 'Still could not load. Check your connection and try again.' She needs to see that the tap did something.

## The admin error banner renders a nested sentence inside brackets, producing a doubled full stop

- Where: `src/components/admin/AdminStore.tsx:233`
- Found by: copy-voice
- Evidence: ? `${what} didn't save (${detail}). The change was undone, please try again.`
- Fix: Drop the brackets and let the reason stand as its own sentence: `${what} didn't save. ${detail} Nothing changed, please try again.` and change the what strings at lines 299 and 311 from "Best-seller flag" and "Recommended flag" to "Best-seller" and "Michelle's pick".

## A failed save rolls a whole stale order back on screen, undoing a later change that did save

- Where: `src/components/admin/AdminStore.tsx:266`
- Found by: client-server-truth
- Evidence: const before = orders.find((o) => o.orderNumber === orderNumber); patchOrderLocal(orderNumber, patch); persist( action, () => { if (before) { setOrders((prev) => prev.map((o) => (o.orderNumber === orderNumber ? before : o))); } }, what, );
- Fix: Roll back only the keys the failed patch touched rather than replacing the order object, or re-pull that order from the server after a failure instead of restoring a snapshot.

## The cutoff countdown runs on the phone's clock while every other cutoff decision runs on Singapore time

- Where: `src/components/checkout/CutoffBanner.tsx:24`
- Found by: input-boundaries
- Evidence: const [h, m] = cutoffTime.split(":").map(Number); const now = new Date(); const cutoff = new Date(now); cutoff.setHours(h, m || 0, 0, 0); const diff = cutoff.getTime() - now.getTime();
- Fix: Build the cutoff moment from singaporeNow the way the checkout page builds earliest, so the countdown and the date field always tell the customer the same thing whatever their phone clock says.

## Product rails never snap, because snap-start is set on the cards but scroll-snap-type is set nowhere

- Where: `src/components/product/MenuBrowser.tsx:46`
- Found by: verified lead
- Evidence: MenuBrowser.tsx:46 is `trackClassName="-mx-6 flex gap-4 overflow-x-auto px-6 pb-2 no-scrollbar xl:mx-0 xl:grid xl:grid-cols-4 xl:gap-6 xl:overflow-visible xl:px-0 xl:pb-0"` with no snap-x and no snap-mandatory, while line 51 is `"shrink-0 basis-[72%] snap-start sm:basis-[40%] lg:basis-[31%] xl:basis-auto"`. RecommendationRail.tsx:14 and 19 are the same shape. I grepped src for `snap-|scroll-snap|scroll-px|scroll-pl` and got four hits total, the two snap-start classes and the two doc comments calling these scroll-snap rails. ScrollRail.tsx:133 is the only thing that adds to the track and it adds only `cn(trackClassName, "cursor-grab xl:cursor-auto")`. scroll-snap-align does nothing while the 
- Fix: The lead's fix needs a correction before anyone applies it. ScrollRail writes scrollLeft directly in two places, at line 94 during a mouse grab-pan and at line 169 from the bow slider's onChange, and mandatory snapping re-snaps after a programmatic scroll, so `snap-mandatory` would make both of those jump between card boundaries on any viewport under xl. Use `snap-x snap-proximity scroll-px-6 xl:snap-none` on the trackClassName in both files, then check the grab-pan and the bow slider still move smoothly at tablet width before shipping. scroll-px-6 is needed either way so a snapped card lands against the px-6 padding rather than under it. While in there, correct the two doc comments if the snapping is not restored.

## Tying a favourite ribbon is optimistic and never rolls back when the save fails

- Where: `src/components/wishlist/WishlistContext.tsx:86`
- Found by: verified lead
- Evidence: Read the whole file. `toggle` on lines 71-99 is as described. Local state is updated first on lines 78-83, then lines 86-96 fire the write and discard the result: void (async () => { if (wasFavourite) { await supabase .from("wishlists") .delete() .eq("user_id", userId) .eq("product_id", productId); } else { await supabase.from("wishlists").insert({ user_id: userId, product_id: productId }); } })(); Neither await destructures anything, so the `{ error }` both queries resolve with is never read, and there is no path that restores the previous set. postgrest-js resolves rather than throws on a failed request by default, so this does not even surface as an unhandled rejection. It is fully silent
- Fix: Destructure `{ error }` from both the delete and the insert, and on error reverse just this one id with a functional update so a concurrent toggle is not clobbered, roughly `setIds((prev) => { const next = new Set(prev); if (wasFavourite) next.add(productId); else next.delete(productId); return next; })`. Correct the lead's second half. It proposes a short line of text near the button, which does not fit. FavouriteButton renders as a bare icon positioned `absolute right-3 top-3 z-10` over the product photo in src/components/product/ProductCard.tsx line 73, and it also appears on the product detail page. A paragraph beside it would land on top of the image and would repeat across every card in the grid. The bow snapping back is the honest signal. Announce it the way the same card already announces an add, with the `sr-only role="status" aria-live="polite"` pattern on ProductCard line 168, carrying "We couldn't save that. Please try again." While in this file, give `loadFor` on line 40 the same treatment. Leave the previous set alone when the read errors instead of blanking it to an empty Set, otherwise a failed load makes every saved treat look untied and the next tap inserts a row that already exists.

## A failed review request burns the one claim it gets, unlike every other claim-then-send in the codebase

- Where: `src/lib/admin-db.ts:242`
- Found by: verified lead
- Evidence: The defect is real but sits at src/lib/admin-db.ts:242, not the 247 the lead cited. Line 247 is a comment inside updatePaymentStatus. maybeSendReviewRequest claims the send at :213-219 with `.update({ review_request_sent_at: new Date().toISOString() }).eq("id", order.id).is("review_request_sent_at", null).select("id").maybeSingle()` under the comment 'Claim the send atomically so a re-completed order never re-nudges.' Line 242 is then `await sendReviewRequestEmail({ to: order.email, name: order.customer_name, orderNumber, products });` with the return value discarded. src/lib/email.ts declares that function `Promise<boolean>` at :405 and its body ends at :417 with `return send(...)`, and sen
- Fix: Mirror the sibling pattern, at admin-db.ts:242. `const delivered = await sendReviewRequestEmail({ to: order.email, name: order.customer_name, orderNumber, products }); if (!delivered) { console.error(`[review-request] send failed for ${orderNumber}, releasing the claim`); await supabase.from("orders").update({ review_request_sent_at: null }).eq("id", order.id); }`. One thing the lead missed while you are in this function. The two early returns at :233 and :240, for no product ids and no matching products, also leave the claim stamped. Those are correct to leave stamped, since there is nothing to ask a review about, but the release above must not be pulled up above them or a broken order would be re-checked on every completion.


---

# Checked and dismissed

Kept so nobody re-raises them.

- **NOT_WORTH_FIXING** Settings sticky bar says "All changes saved" while a delivery-zone edit is pending
- **NOT_WORTH_FIXING** "Record a refund" is offered on orders where no money ever arrived
- **NOT_WORTH_FIXING** The Payment dropdown marks an order paid with no confirmation
- **MOOT** A failed admin load is marked as loaded, so admin screens print invented defaults
- **NOT_WORTH_FIXING** Dashboard Recent orders table renders a bare header strip when there are no orders
- **NOT_WORTH_FIXING** The allergen and dietary chips in the product editor carry no aria-pressed
- **REFUTED** Coloured panels declare a background with no colour beside it, so dark-mode clients blank the order details
- **NOT_WORTH_FIXING** No preheader, so every inbox preview opens with the wordmark and a restated subject
- **REFUTED** Two emails tell the customer to reply, but no send sets a reply-to address
- **REFUTED** When the delivery estimate fails or is throttled, the summary shows the flat fee and the customer is charged the real one
- **NOT_WORTH_FIXING** The Delivery option quotes "from" a flat fee that is never actually charged once distance zones are configured
- **NOT_WORTH_FIXING** Buy button on bundles and build-a-box is hand-rolled and shorter than the shared Button
- **NOT_WORTH_FIXING** Email confirmation landing page is off the radius scale and its heading is unbolded
- **NOT_WORTH_FIXING** Bundle tiles are flat while the product tile carries the card shadow and lift
- **MOOT** fetchRefundedCents returns 0 when its query fails
- **MOOT** A Stripe refund that succeeds is not recorded when the order update fails
- **MOOT** Modal scroll lock is a no-op because globals.css puts overflow-x on html

---

# Work order

Repo root: `C:\Users\seani\Michelle's Munchies`. Paths below are relative to it.

---

# WORK ORDER

## Ranked fixes

Rank is by effect on a real person. Same-file items sit together. Batch letter in brackets.

| # | File | Change | Batch |
|---|---|---|---|
| 1 | `src/lib/stripe.ts:13` | `cached = new Stripe(key, { timeout: 10_000, maxNetworkRetries: 1 });`. Today a stalled Stripe can hold checkout open for up to 3 x 80s after the order row and confirmation email already exist. | A |
| 2 | `src/lib/rate-limit.ts:61` | Add `signal: AbortSignal.timeout(2000)` to the Upstash fetch. The in-memory fallback at :101 only runs on a rejection, so a stalled Redis currently hangs all 33 rate-limited actions including `placeOrder` and `adminSignIn`. | A |
| 3 | `src/app/checkout/page.tsx:606, :1117-1121, :1150-1152` | Compute one boolean server-side from `getStripe() !== null`, seed it to the browser the way `FeaturesProvider` is seeded from the root layout, branch all three strings. Payments on, steps read "Your details", "Pay securely", "We start baking". Summary box reads "You'll pay on the next page. PayNow and cards both work. We'll email you a link to follow your order." Button subtext reads "Payment happens on the next page." Payments off, keep today's wording exactly. Do not write copy claiming card payment is the only way, because `actions.ts:772-774` still falls back to the tracking page. | A |
| 4 | `src/lib/payments.ts:75` | `cancel_url` to `${siteUrl}/track/${input.trackingToken}`. Backing out of Stripe currently returns to a blank checkout with the order already committed, and nothing stops a second order. Add one line to `src/app/track/[token]/page.tsx` near the pay panel at :189-205 reading "Your order is saved and nothing has been charged yet." No resume-payment button, a Checkout Session URL is single use. | A |
| 5 | `src/lib/admin-actions.ts:256` | Give `cancelOrderAction` a second `cancelWithoutRefund` parameter and pass it to `cancelAndRefundOrder`. The escape hatch is written but unreachable, so an order whose Stripe refund will never succeed can never be cancelled. | B |
| 6 | `src/components/admin/AdminStore.tsx:434-445` | Carry `refundFailed` out of `cancelOrder`. On true, second confirm reading "Stripe would not send this money back. Cancel the order anyway and send the money to the customer yourself?" then call again with the flag. Add `await refresh();` inside `if (result.ok)` after the local patch, the way `addManualOrder` does. Without it her money figures stay wrong on screen and the menu keeps the sold-out state the cancel just undid. | B |
| 7 | `src/lib/admin-db.ts:840` | Replace `return { ok: false, error: updErr.message };` with her words, keep the raw text for console and Sentry. Refunded true: "The ${formatPrice(outstandingCents)} refund went back to the customer, but the order could not be marked cancelled. Open it and cancel it once more. No money will move a second time." Refunded false: "The order could not be cancelled. Please try again in a moment." | B |
| 8 | `src/components/product/ReviewForm.tsx:83-89` and `src/components/product/Stars.tsx:13` | Render `☆` when `(hover \|\| rating) < star`, `★` otherwise, unchosen glyph `text-muted`. `text-line` on white is 1.32:1, so an unrated form shows no visible control while `handleSubmit` refuses to post without one. Do not just darken the filled star. | C |
| 9 | `src/components/product/ReviewForm.tsx:97` | `text-sm` to `text-base sm:text-sm`. iOS Safari zooms on focus and never zooms back. | C |
| 10 | `src/components/product/NotifyBackInStock.tsx:83` | Same swap. This is the sold-out page where a disappointed customer is being asked for an email. | C |
| 11 | `src/components/product/BoxBuilder.tsx:154, :164` | Line 164 keeps `disabled={choice.soldOut}` and moves the rest to `aria-disabled={remaining <= 0}`. Line 154 `disabled={qty === 0}` becomes `aria-disabled={qty === 0}`. Both class strings gain `aria-disabled:opacity-40`. Copy of `FlavourBoxPicker.tsx:146-170`, which already carries the comment explaining the focus drop. `bump()` already guards both cases. | C |
| 12 | `src/app/cart/page.tsx:148` | `updateQuantity(item.key, Math.max(1, item.quantity - 1))`, plus `aria-disabled={item.quantity === 1}` and `aria-disabled:opacity-40`. Today minus at one deletes a line that can carry a typed birthday message and an uploaded photo, with no confirm and no undo. `OptionPicker.tsx:238` already floors this control. | C |
| 13 | `src/app/cart/page.tsx` list region | Add one `<span className="sr-only" role="status" aria-live="polite">` holding the last removal, worded "Removed Ondeh Ondeh Cake from your cart." then cleared. Follow `MenuBrowser.tsx:276` and `ProductCard.tsx:168`. Move focus to the cart heading after a removal. | C |
| 14 | `src/app/cart/page.tsx:173` | Remove is a 20px tall unpadded text button that deletes for good. Change to `-mr-2 rounded-full px-3 py-2.5 text-sm font-semibold text-muted transition hover:text-rose-deep`, 40px tall, flush to the card edge. Then cart steppers at :149 and :164 to `h-11 w-11` and the value span from `w-8` to `w-10`. | C |
| 15 | `src/components/product/AllergenChips.tsx:48` | Swap `left-1/2 -translate-x-1/2` for `right-0` so the bubble grows leftward instead of being clipped by `ProductCard.tsx:69` `overflow-hidden`. Do not remove that `overflow-hidden`, it is what rounds the card top. Better option under judgement calls. | C |
| 16 | `src/app/admin/(panel)/bake-list/page.tsx:20` | Filter to statuses that still need an oven, so received, confirmed, baking. Under each date heading add a line built from the ready and out_for_delivery count, worded "3 orders already baked and waiting". Leave `windows` counting every live order so the bake order stays right. | D |
| 17 | `src/app/admin/(panel)/bake-list/page.tsx:50, :62` | Split the sorted array on `date >= singaporeDateString()` and render past dates in their own group below, headed "Overdue", each with "This day has already gone by. Move the order to a new date or mark it done." Replace the `toISODate(new Date())` at :62 with `singaporeDateString()`. Do not add the flat `scheduledDate >= today` filter the sibling screens use, that would hide paid work. | D |
| 18 | `src/app/admin/(panel)/orders/page.tsx:199-236` | `hidden sm:table-cell` on the Fulfilment and Ordered headers (204, 205) and their body cells (233, 234-236), table to `min-w-[560px]`. Copy of the dashboard pattern at `src/app/admin/(panel)/page.tsx:193-224`. Status and Payment are currently off screen on a 390px phone and nothing is sticky, so swiping right loses the order number and customer name. | D |
| 19 | `src/app/admin/(panel)/promos/page.tsx:83-98` | Wrap both handlers in try/catch/finally, clear `busyId` in the finally, flip local state only after the action resolves. Add `rowError: { id, message }` rendered beside the row buttons. Pause failure: "That did not save. The code is still active. Please try again." Delete failure: "That code is still there. Please try again." Today a rejection leaves the row showing Active with both buttons dead until a reload, and this page is outside AdminStore so it gets no banner. | D |
| 20 | `src/app/globals.css:348` | Stop taking `.print-only-target` out of flow. Hide siblings with `display: none` inside the print block and let the target print in normal flow. Safari currently prints only the first page of a bake sheet. | D |
| 21 | `src/app/admin/(panel)/products/page.tsx:355` | Parse once, guard with `Number.isFinite`, refuse the save with a plain line when the price is not a number above zero, in the same block that already refuses a bad slug. Same for the cost field, which currently writes `NaN` through as a silent null. A blank price box saves the treat at S$0.00. | D |
| 22 | `src/components/admin/NewOrderModal.tsx:334` and its sibling class string | Drop the trailing `text-sm` and let `compactInputClass` supply the size, or use `sm:text-sm`. | D |
| 23 | `src/lib/email.ts:320, :341, :361, :485` | Front-load the news, keep the number trailing, matching :281. Subject map beside `statusLines` at :297. received "Your order is in the bake book", confirmed "Your order is confirmed", baking "Your treats are in the oven", ready "Your order is ready", out_for_delivery "Your order is on its way", completed "Thanks for ordering". :341 "Your order is cancelled", :361 "We moved your order to a new date", :485 "Your gift still needs a delivery address". Append the order number after a comma. Do not drop the number, Michelle quotes it on WhatsApp. | E |
| 24 | `src/lib/email.ts:207` | Widen `send()` to take optional headers, set `List-Unsubscribe: <url>` on the five marketing sends only. Marketing opt-out URL for winback, occasion, birthday and abandoned cart, newsletter URL for the newsletter. Skip when the token is absent and for the `test-preview` token at `newsletter-actions.ts:109`. Do not add `List-Unsubscribe-Post`, both unsubscribe routes are GET-only and one-click would 405. This matters because the same address sends the order confirmations. | E |
| 25 | `src/lib/newsletter-actions.ts:83-92` | Add `last_newsletter_at timestamptz` and `last_newsletter_subject text` to `newsletter_subscribers`. Stamp both the moment `sendNewsletterEmail` returns true. At the top of the action, skip any subscriber stamped with the same trimmed subject in the last 24 hours. Then change `src/app/admin/(panel)/newsletter/page.tsx:46-53` to "Sending stopped partway. Send again to finish, no one gets it twice." Ship the copy and the stamping together, the copy is only true once stamping exists. | E |
| 26 | `src/lib/admin-db.ts:242` | `const delivered = await sendReviewRequestEmail(...)`, and on false log and set `review_request_sent_at` back to null. The claim is taken at :213-219 and never released, so a failed send means the customer is never asked. Do not lift the release above the early returns at :233 and :240, those are correct to stay stamped. | E |
| 27 | `src/app/globals.css:40` | Add `--color-rose-ink: #a33a56` beside the other tokens. Leave `--color-rose-deep` alone, white on it still passes. Switch text-on-blush and text-on-marble to `text-rose-ink` at `cart/page.tsx:189, :199`, `menu/[slug]/page.tsx:200`, `checkout/page.tsx:681, :810, :816, :1028, :1068, :1126`, `gift/[token]/page.tsx:64`, `track/[token]/page.tsx:409, :421`, `about/page.tsx:44`, `account/sign-in/page.tsx:82`, `account/sign-up/page.tsx:151`, `account/forgot/page.tsx:70`, `CutoffBanner.tsx:43`, `AdminShell.tsx:112`. Drop the `/80` and `/90` suffixes at `gift/[token]/page.tsx:66`, `track/[token]/page.tsx:413` and `account/page.tsx:138` rather than carrying them over, those are at 3.12:1. Do the whole list in one pass or the shop ends up with two pinks side by side. | F |
| 28 | `src/app/contact/page.tsx:43` | "You can move your date and time yourself on your order tracking page, right up until we confirm the order. After that, or if your date is close, message us and we will sort it out." | F |
| 29 | `src/app/account/actions.ts:108, :171` | :108 "We couldn't create your account with those details. Check your email and password, then try again." :171 "We couldn't send that link just now. Check your email address and try again." Keep the real message for console and Sentry. | F |
| 30 | `src/app/admin/(panel)/settings/page.tsx:736, :834` | :834 "Not on the map yet, so delivery stays on the flat fee above. The map lookup still needs to be switched on." :736 split into "The flat delivery fee above stays the fallback. It is used until zones are set up here, or whenever an address can't be located." | F |
| 31 | `src/components/admin/AdminStore.tsx:233, :299, :311` | :233 to `${what} didn't save. ${detail} Nothing changed, please try again.` Change the `what` strings to "Best-seller" and "Michelle's pick". | F |
| 32 | `src/app/checkout/page.tsx:475, :743` | Both to `We bake to order, so the earliest date is ${formatLongDate(earliest)}.`, matching `checkout/actions.ts:556`. | F |
| 33 | `src/components/track/OrderChangePanel.tsx:34, :48, :101` | `.catch(() => null)` on both action calls, then `setBusy(false)`, then on null set "We couldn't send that just now. Please check your connection and try again." Busy label `{busy ? "Saving..." : "Save new date"}`. Keep the wording non-committal, a lost response can mean the reschedule did land and `MAX_RESCHEDULES` is 3. Today a dropped request leaves both buttons dim forever with nothing said. | G |
| 34 | `src/components/track/AddToOrderPanel.tsx:94`, `src/components/gift/GiftScheduleForm.tsx:30`, `src/components/product/NotifyBackInStock.tsx:45` | Same catch plus an error message. Their busy labels are already correct. | G |
| 35 | `src/components/wishlist/WishlistContext.tsx:40, :86-96` | Destructure `{ error }` from the delete and the insert, and on error reverse just that one id with a functional update. In `loadFor`, leave the previous set alone when the read errors instead of blanking it. Announce with the `sr-only role="status" aria-live="polite"` pattern from `ProductCard.tsx:168`, "We couldn't save that. Please try again." No text beside the button, it sits over the photo on every card. | G |
| 36 | `src/components/account/ShareWishlistButton.tsx:25` | Fetch the link before the copy needs it, or pass `navigator.clipboard.write` a `ClipboardItem` whose `text/plain` value is the pending promise. Safari has already spent the tap by the time the await returns. | G |
| 37 | `src/components/content/InstagramGrid.tsx:43` | `next/image` with `fill` inside the existing aspect-square wrapper and `sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"`. The Supabase host is already in `remotePatterns`. Minimum fallback is `loading="lazy" decoding="async"`. | H |
| 38 | `src/app/menu/page.tsx:16` | Await `fetchStoreSettings` first, then `Promise.all` the three independent chains. Four round trips become two. | H |
| 39 | `src/app/page.tsx:46` | Settings first, then `Promise.all` the featured rail and review highlights behind the same gate. Three serial reads become two. | H |
| 40 | `src/components/ui/MascotSays.tsx:54` and `src/components/layout/SiteHeader.tsx:30` | Real display sizes, 96 for hero, 64 for quiet, 56 in the header. Currently a 512px image is preloaded into a 96px box. | H |
| 41 | `src/app/checkout/page.tsx:175` | Turn the route into a thin server component that awaits `fetchStoreSettings` and passes fields as props to a renamed `CheckoutForm`. `settingsLoaded` starts true and the time-picker placeholder goes. The layout already does this for feature flags through `SiteChrome`. | H |
| 42 | new `loading.tsx` in `src/app/menu`, `src/app/menu/[slug]`, `src/app/account`, `src/app/track/[token]` | Shape each like the page it stands in for. `PanelLoading` suits the two single-panel routes only, its `py-24` centred mascot collapses the menu grid height. Lift it to `src/components/ui/` if it serves both sides. Side payoff, a dynamic route with no boundary has nothing for Next to prefetch on a Link. | H |
| 43 | `src/app/menu/[slug]/page.tsx:34`, `src/app/bundles/[slug]/page.tsx`, `src/app/build-a-box/[slug]/page.tsx` | Add `openGraph` with title, description, `type: "website"` and the first image, falling back to `/og.png`. `product.imageUrls` already holds absolute Supabase URLs. Every cake link pasted into WhatsApp currently shows the same generic card. | I |
| 44 | `src/app/layout.tsx:41` | `alternates: { canonical: "/" }` on root metadata, then the real path per public route. | I |
| 45 | `src/app/menu/[slug]/page.tsx:88` | When `product.options.length > 0` emit `AggregateOffer` with `lowPrice`, `highPrice` and `offerCount`. Keep the flat `Offer` for products with no options. | I |
| 46 | `src/app/sitemap.xml/route.ts:24` | Map `fetchActiveBundles` and `fetchActiveBoxTemplates` in behind their feature flags, same priority as products. | I |
| 47 | `src/app/confirm/[token]/page.tsx:7` | Title to `"Confirm your email"` and let the root template add the brand. | I |
| 48 | `src/lib/boxes.ts:136` | Put the size's own identity in the cart key, `fbox::<productId>::<sizeLabel>::<count>::<labels>`, and resolve by identity rather than by count. Until that lands, refuse the product save when two sizes share a count and have `addBoxSize` start on a free count. Today two sizes with the same count collapse into the first, at its price and its name. | J |
| 49 | `src/app/checkout/actions.ts:460` | Cap both steppers at 99 so the cart cannot hold a quantity checkout refuses, and name the treat and the number in the server line, "We can only take 99 of Vanilla Cupcakes on one order. Please lower that line or message us for a bigger batch." | J |
| 50 | `src/lib/admin-db.ts:104` | Map `discount_cents` onto `AdminOrder`, subtract it in the Insights revenue and profit fold, show a discount line between items and Total in the order detail. Insights currently overstates profit on every promo order. | J |
| 51 | `src/app/checkout/page.tsx:519-523` | Collect the ids in `found` that resolve to a real element, sort with `compareDocumentPosition`, focus the first. Validation order does not match DOM order, so a delivery customer is focused on Name below a postal-code error that scrolls off screen. Skip `order` deliberately, it has no element and its message renders right above the button. | J |
| 52 | `src/app/checkout/page.tsx:120-126` | Hold `earliest` in state, refresh from `singaporeNow()` on a one-minute interval, push `date` forward when it moves with a line by the field reading "The date rolled over, so we've moved your order to Sat, 9 Aug 2026." More important, key the server's date refusal to the date field instead of `errors.order`. A page opened at 23.50 and submitted at 00.05 is refused in the summary while the schedule section says the picked date is fine. No cutoff time is set today, so the cutoff framing does not apply. | J |
| 53 | `src/components/checkout/CutoffBanner.tsx:24` | Build the cutoff moment from `singaporeNow`. Inert until a cutoff time is set, `daily_cutoff_time` is currently NULL. | J |
| 54 | `src/components/product/MenuBrowser.tsx:46`, `src/components/product/RecommendationRail.tsx:14, :19` | `snap-x snap-proximity scroll-px-6 xl:snap-none` on the track. Not `snap-mandatory`, `ScrollRail` writes `scrollLeft` directly at :94 and :169 and mandatory snapping would fight both. Check the grab-pan and bow slider at tablet width before shipping. Correct the doc comments at `MenuBrowser.tsx:30` and `RecommendationRail.tsx:6` either way. | J |
| 55 | `src/components/account/ReferralCard.tsx:37` | Drop `font-display`. The six-character hex code is drawn in the handwriting face and a friend has to retype it into a plain input, and a mistyped code fails silently at `actions.ts:132`. Leave `checkout/page.tsx:927` alone, that is a section heading. | J |
| 56 | `src/components/admin/AdminShell.tsx:247` | Track a retrying flag, label "Trying...", disable while in flight, and on a second failure "Still could not load. Check your connection and try again." | J |
| 57 | `src/components/admin/AdminStore.tsx:266` | Roll back only the keys the failed patch touched, or re-pull that one order, instead of restoring a whole stale snapshot that undoes a later change which did save. | J |

---

## Batches

Each batch is one branch, one gate check.

**A. Checkout and payment path.** Items 1-4. Files `src/lib/stripe.ts`, `src/lib/rate-limit.ts`, `src/lib/payments.ts`, `src/app/checkout/page.tsx`, `src/app/track/[token]/page.tsx`.
Gate: with `STRIPE_SECRET_KEY` set, place an order, back out of the Stripe page, confirm you land on the tracking page with one order and an empty cart. With the key unset, confirm the checkout copy is byte-for-byte what it is today. Point Upstash at a dead host and confirm checkout still completes inside two seconds.

**B. Admin cancel and refund.** Items 5-7. Files `src/lib/admin-actions.ts`, `src/components/admin/AdminStore.tsx`, `src/lib/admin-db.ts`.
Gate: cancel a paid test order and confirm the refund figure on screen matches the database after the refresh. Force a Stripe refund failure and confirm the second confirm appears and the order can be cancelled.

**C. Storefront controls a finger touches.** Items 8-15. Files `ReviewForm.tsx`, `Stars.tsx`, `NotifyBackInStock.tsx`, `BoxBuilder.tsx`, `cart/page.tsx`, `AllergenChips.tsx`.
Gate: on a real iPhone, open a product with no reviews and confirm five outlined stars are visible, tap the review box and confirm no zoom, fill the last slot in a box and confirm the plus keeps focus, press minus on a cart line at quantity one and confirm nothing is deleted.

**D. Michelle's screens.** Items 16-22. Files `bake-list/page.tsx`, `orders/page.tsx`, `promos/page.tsx`, `globals.css` print block, `products/page.tsx`, `NewOrderModal.tsx`.
Gate: on a 390px viewport, read Status and Payment on the orders list without scrolling sideways. Print a two-page packing sheet in Safari and confirm both pages come out. Kill the network and pause a promo, confirm the row explains itself and the buttons come back.

**E. Email.** Items 23-26. Files `src/lib/email.ts`, `src/lib/newsletter-actions.ts`, `src/app/admin/(panel)/newsletter/page.tsx`, `src/lib/admin-db.ts`. Needs one migration.
Gate: send each status email to a test inbox and read the subject in a phone list. Check the Gmail unsubscribe control appears beside the sender on a winback and a newsletter, and does not appear on an order confirmation. Cut a newsletter send halfway and resend, confirm no one gets two.

**F. Contrast and copy voice.** Items 27-32. One pass over `globals.css` and every listed call site plus the four copy files.
Gate: every listed pairing measures at or above 4.5:1. Grep the diff for em dashes, semicolons and brackets.

**G. Client actions that can drop.** Items 33-36. Files `OrderChangePanel.tsx`, `AddToOrderPanel.tsx`, `GiftScheduleForm.tsx`, `NotifyBackInStock.tsx`, `WishlistContext.tsx`, `ShareWishlistButton.tsx`.
Gate: throttle to offline mid-tap on each of the five and confirm a message appears and the button comes back. Tap Share my wishlist in real Safari and confirm the link is on the clipboard.

**H. Speed.** Items 37-42. Files `InstagramGrid.tsx`, `menu/page.tsx`, `page.tsx`, `MascotSays.tsx`, `SiteHeader.tsx`, `checkout/page.tsx`, four new `loading.tsx`.
Gate: Lighthouse mobile on home and menu before and after. Tap a menu card on a throttled connection and confirm a skeleton appears within a frame.

**I. Metadata.** Items 43-47.
Gate: paste a product, a bundle and a box link into WhatsApp and confirm three different cakes. Validate the product page in the Rich Results test.

**J. Everything else.** Items 48-57. Split if it gets long. Item 48 and item 50 are the two with real teeth here, the rest is polish.
Gate: unit test the flavour box key with two sizes at the same count. Compare one month of Insights profit against the orders table by hand.

Suggested order: A, B, C, then D and E in parallel if two people, then F, G, H, I, J.

---

## Judgement calls, not defects

1. **Is Stripe checkout the live payment path, or is PayNow on WhatsApp?** `.env.local` has a live-shaped `STRIPE_SECRET_KEY`. Batch A assumes yes. If the answer is no, unset the key and items 3 and 4 collapse to nothing. Decide this before batch A starts, it is upstream of four fixes.
2. **The refund escape hatch.** Wire `cancelWithoutRefund` through, or delete it along with `refundFailed` and its comment. Leaving it as dead code that promises a way out is the one option to rule out.
3. **Orders table on a phone.** Hide two columns, which is fifteen minutes, or render each order as a card below `sm`, which is better and costs an afternoon.
4. **Allergens on the menu card.** Right-anchor the tooltip, or drop the popup on the grid and print "Contains peanuts, dairy" under the description as `text-xs text-muted`. The second is better. Allergen text should not need a tap, and the chip is a 28px target for health-critical information.
5. **Product rails.** Restore snapping with `snap-proximity`, or delete the inert `snap-start` classes and correct the two comments. Both are honest, doing neither is not.
6. **Newsletter stamping** adds two columns to a live table. If the owner would rather not migrate, the alternative is to change only the error copy to stop naming a check she cannot do, and accept that a cut send starts over.
7. **Failed review request.** Release the claim so the next completion retries, or leave it burned. Releasing means an order re-completed by hand could nudge twice.
8. **Insights profit** will move once `discount_cents` is subtracted. Past months will read lower than she remembers. Confirm she wants the corrected number before shipping item 50.
9. **Points balance font.** `account/page.tsx:130` is in the handwriting face. Nobody transcribes their own points, so this is taste, not a defect. Leave it unless she wants it changed.
10. **Mascot sizing.** Fixed `width`/`height` of 96 and 64, or keep 512 and add `sizes="96px"`. Either works.
11. **Flavour box duplicate counts.** The cart-key change is the real fix. The save-time guard is the cheap one. Doing only the guard leaves existing bad rows in the database.

---

## Contradictions

1. **Item 4 versus a written design decision.** `ClearCartOnMount.tsx:6-9` says in its own comment that the cart is deliberately kept so a cancelled Stripe payment returns the customer to checkout with the cart intact. Changing `cancel_url` to the tracking page makes that comment false and clears the cart there, because checkout set the `mm-order-placed` marker before redirecting. That is the right outcome now that the order already exists, but the comment must be rewritten in the same commit or the next reader will revert the fix.

2. **Item 14 versus itself.** It takes the cart steppers to 44px and the box pickers to 40px. Same control, two sizes, on grids that sit two taps apart. Pick one number for both, or write the reason into the code, otherwise the next person will unify it in the wrong direction.

3. **Item 17 versus the sibling prep screens.** Packing slips and the shopping list both hard-filter to `scheduledDate >= today`. The bake list is being told to keep past days on purpose. That is deliberate and correct, a paid order whose date slipped still needs baking, but it means three prep screens now disagree about yesterday. Say so in a comment, and consider whether packing slips should show the Overdue group too.

Note: two of the leads mention a deposit-owed flag on the orders table and a deposit line elsewhere. Both are moot, deposits are gone. Nothing in this work order restores them.
