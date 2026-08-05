# Security audit 2026-07-31 — PARTIAL RUN

## Read this first

This audit DID NOT FINISH. 3 of 12 agents completed; 9 were killed by a session
limit. Three of the four lenses ran (server actions, newest code, IDOR/authz);
the fourth (injection, and data reaching the browser) NEVER RAN.

8 findings were raised and NONE were auto-verified, because every exploitability
verifier died. The run correctly reported them as "never tested" rather than as
refuted. Two were then hand-verified and FIXED (below). The remaining six are
UNVERIFIED LEADS: things to check, not confirmed vulnerabilities, and not a pass.

## What the three completed lenses cleared

Checked and found sound, worth not repeating:

- All 40 admin server-action exports await requireAdmin() on the first line,
  before any read or write. No auth-after-side-effect ordering bug.
- Next is pinned at 15.5.19, so the middleware-bypass CVE (fixed in 15.2.3) does
  not apply.
- Tokens are 128-bit from crypto.randomBytes; order numbers carry an 8-char
  rejection-sampled base36 suffix. Neither is enumerable.
- Every per-address email limit uses scope "global" (no client IP in the key),
  and Upstash is now configured, so those buckets are shared across instances.
- Newsletter and back-in-stock are double opt-in, so nobody else's inbox can be
  added to a list.
- Every interpolated value in email.ts goes through escapeHtml, and no href or
  src in that file interpolates attacker-controlled data.
- order_refunds and email_opt_outs have RLS with zero policies, so they are
  unreachable by anon and authenticated.
- remove_items_from_order is scoped by order_id AND item ids, so items belonging
  to another order cannot be removed or counted.
- The new refusal to un-mark a card payment holds, because the Stripe intent id
  is always present on a card-paid order: the webhook stamps it even on the path
  where it declines to apply the payment.
- Points arithmetic across paid, undo, paid nets correctly in both directions.
- The marketing opt-out cannot be used to opt somebody else out, to enumerate
  customers, or to probe whether an address exists.
- Every createAdminClient call site reachable by an untrusted caller applies its
  own ownership filter, since it bypasses RLS.

## Hand-verified and FIXED

**Lead 7 — a cancellation request permanently exempted an order from the sweep.**
requestCancellationAction wrote a marker into owner_note, and the stale-order
sweep treats an owner_note as proof a human was involved and leaves the order
alone. So the one order a customer had actually asked to be rid of became the one
order nothing could reclaim, holding a capped promo's redemption and reserved
points for good. Reachable by anyone with a tracking link, and a link is minted by
placing a guest order with no payment. Fixed by migration 0040 (its own
cancellation_requested_at column), with the request surfaced in the admin panel.
Same mistake migration 0038 fixed for the gift reminder, in a different writer.

**Lead 3 — the gift recipient link stayed a live write credential after use.**
scheduleGiftAction checked only the order status, never recipient_scheduled_at, so
anyone the link was forwarded to could silently redirect a paid gift to their own
address, repeatedly. It now answers once; later changes go through Michelle.

## Still unverified

| # | Severity | Title |
|---|---|---|
| 1 | high | placeOrder never validates the gift message, so anyone can send arbitrary attacker-written email to any inbox from the bakery's own sending domain |
| 2 | medium | Unbounded free text on the public order endpoint is reloaded in full by the admin panel on every mount, letting an anonymous attacker make the panel unusable with no in-app cleanup |
| 4 | medium | recordCheckoutIntentAction lets an anonymous caller destroy another address's abandoned-cart record and plant attacker-written lines into the email the shop sends to that address |
| 5 | medium | A tracking-link holder can permanently exempt an unpaid order from the stale-order sweep, burning a capped promo's redemptions forever |
| 6 | medium | Gift self-scheduling re-prices delivery but reuses the stale free_delivery discount, cutting the food price |
| 8 | medium | placeOrder applies no length or presence validation to the customer free-text fields it stores and renders |

## Full detail of the unverified six

### 1. [HIGH] placeOrder never validates the gift message, so anyone can send arbitrary attacker-written email to any inbox from the bakery's own sending domain

- Actor: E (someone abusing the bakery's sending domain to mail a third party); reachable with only the public site, no account
- Location: `src/app/checkout/actions.ts:390`

**Exploit path.** 1. `placeOrder` is an exported function in a "use server" file, so it is a public POST endpoint. Its server-side contact validation (checkout/actions.ts:390-403) checks only `email` against EMAIL_RE and `phone` against normalizeSgPhone. `input.name`, `input.notes`, `input.giftMessage` and `input.recipientName` are never validated, never length-capped and never scrubbed; they pass straight through to createOrder (orders-db.ts:197-203), which only `.trim()`s them. The checkout form itself caps the gift message at 200 characters (checkout/page.tsx:965) — that cap is client-side only.
2. Attacker POSTs placeOrder directly with: `email: "victim@example.com"`, `phone: "91234567"`, `name: "Michelle"` (only the first whitespace token is echoed), one real catalogue product at quantity 1, `fulfillmentType: "pickup"`, a `scheduledDate` past the 2-day lead time, a `timeWindow` from settings, `isGift: true`, and `recipientName` / `giftMessage` set to arbitrary multi-line prose containing a URL.
3. Live settings allow it: `feature_gifting = true`, `min_order_cents = 0`, `daily_order_cap = null` (verified against project ddwesutmtlytbcluqcuc). The order commits and `after()` fires sendOrderEmails (orders-db.ts:242).
4. email.ts:265-272 builds the CUSTOMER copy — `giftBlock(order, false)` at :270 renders the attacker's `giftMessage` verbatim (escaped for HTML, but unlimited in length and content) inside a styled pink card headed "A gift for {recipientName}", and `send(order.email, ...)` at :272 delivers it to the attacker-chosen address, with the bakery logo, the subject "We got your order, MM-…", and a real "Track your order" button pointing at the bakery's domain.
5. Repeat: the per-address bucket is 5 per hour (checkout/actions.ts:368) and the per-IP bucket is 12 per 5 minutes (:355); victim addresses can be rotated without limit. Compare recordCheckoutIntentAction 90 lines earlier (:291-301), which strips `https?://…`/`www.` links, strips `<>` and caps names at 80 chars precisely because "the flow cannot be used to spam someone else's inbox through our sending domain" — the gift path gets none of that.

**Attacker gains.** A phishing and harassment channel that inherits the bakery's SPF/DKIM-signed Resend domain and its branding: five fully attacker-worded, unlimited-length messages per hour to any chosen inbox, each carrying a legitimate link back to the real site and a plausible pretext ("we got your order"). Deliverability and trust come from the bakery; the reputational damage lands on it too. Every send also plants a junk order in the panel.

**Suggested fix.** Enforce the form's own limits server-side in placeOrder, before createOrder: cap `giftMessage` at 200 chars and `recipientName`/`name`/`notes` at a short length, and run the same scrub recordCheckoutIntentAction already uses (strip `https?://\S+|www\.\S+`, strip `<>`). Stronger still: render the gift message only in the owner's copy — move it out of `giftBlock(order, false)` at email.ts:270 — since the buyer wrote it and does not need it read back, which removes the third-party channel entirely.

---

### 2. [MEDIUM] Unbounded free text on the public order endpoint is reloaded in full by the admin panel on every mount, letting an anonymous attacker make the panel unusable with no in-app cleanup

- Actor: A (anonymous attacker with only the public site)
- Location: `src/lib/admin-db.ts:126`

**Exploit path.** 1. Same missing validation as above: placeOrder caps nothing on `name`, `notes`, `giftMessage`, `recipientName`, `address.unit` (jsonb, only line1-non-empty and a 6-digit postal are checked, checkout/actions.ts:480-485), or the text of each `noteAnswers` entry (:636-645 checks only that a required prompt is non-empty). The orders table has no length limits and no CHECK constraints on any of these columns (verified live: all `text`/`jsonb`, only the five `>= 0` money checks exist).
2. Next.js server actions default to a 1MB body (no `serverActions.bodySizeLimit` is set in next.config.mjs), so each POST can carry ~900KB of padding in those fields. Rate limits allow 12 orders per 5 minutes per IP (checkout/actions.ts:355) and 5 per hour per email address (:368) — email addresses are free to vary, so ~144 padded orders per hour from one source.
3. `fetchAdminOrders` (admin-db.ts:122-131) is the panel's only data source. It runs `select("*, order_items(*), order_refunds(amount_cents)")` with no status filter and a 1000-row limit, and AdminStore refetches it on mount and on every tab refocus. Twenty padded orders is ~18MB pushed to Michelle's phone on every panel load; a hundred is enough to blow the serverless response and fail `loadAdminData` outright.
4. There is no way out from inside the app. Cancelling does not help — cancelled orders are still returned by fetchAdminOrders — and the automatic sweep cannot reach them: expireStaleUnpaidOrders only touches orders whose `scheduled_date` is 3 whole days past (order-cleanup.ts:47, :55) and whose `updated_at` still equals `created_at` (:72). An attacker who books far-future dates keeps the rows alive indefinitely, and the panel needed to delete them is the thing that is broken.

**Attacker gains.** Denial of the owner's only management surface — bake list, packing slips, order status, refunds — at zero cost, from an unauthenticated request, with recovery only through direct database access. Permanent storage bloat alongside it.

**Suggested fix.** Cap the free text where it enters: in placeOrder, clamp `name`, `notes`, `giftMessage`, `recipientName`, each `address` field and each note answer to sane lengths (the form already implies them) and reject rather than truncate silently. Independently, bound the admin snapshot: have fetchAdminOrders select an explicit column list instead of `*`, and either exclude cancelled/completed orders older than a window or paginate, so one bad row cannot dominate the payload.

---

### 4. [MEDIUM] recordCheckoutIntentAction lets an anonymous caller destroy another address's abandoned-cart record and plant attacker-written lines into the email the shop sends to that address

- Actor: A / E (anonymous, abusing the bakery's sending domain)
- Location: `src/app/checkout/actions.ts:271`

**Exploit path.** 1. recordCheckoutIntentAction is an exported "use server" function, so it is a public POST endpoint. It never proves the caller controls the email it is handed — the only test is EMAIL_RE.test(normalizedEmail) at line 277. 2. Attacker POSTs ["victim@example.com", [{name:"URGENT: payment failed, PayNow +65 9xxx xxxx to release your order", quantity:1}, ...up to 15 lines], 0]. The sanitizer at lines 291-301 strips http(s)/www URLs and the characters < and >, then keeps 15 entries of 80 characters each — roughly 1,200 characters of attacker-chosen plain text, digits and phone numbers included. 3. recordIntent (src/lib/checkout-intents.ts:20-25) first DELETEs any checkout_intents row for that email where reminded_at and converted_order_id are null — i.e. it destroys a real customer's live, not-yet-mailed abandoned cart — then inserts the attacker's row in its place. 4. Hours later the cron job sendAbandonedReminders picks it up (checkout-intents.ts:50-120) and sendAbandonedCartEmail (src/lib/email.ts:528-538) renders the attacker's lines as list items in the bakery's own template, complete with a genuine "Finish your order" button, sent from the shop's authenticated (SPF/DKIM-aligned) domain to victim@example.com. Existing limits bound volume but not this: 20/5min per IP and 3/hour per address (scope "global", lines 278-289) still permit one delivered message per reminder cycle per targeted inbox. Preconditions: features.abandonedCart on, the address not already on the opt-out list, and no order placed by that address since the intent was created.

**Attacker gains.** A social-engineering message with attacker-chosen wording and a phone number, delivered to any chosen inbox from the bakery's authenticated sending domain inside a genuine-looking bakery email — the highest-trust phishing envelope the shop has. Plus a write/delete against a record keyed on another person's email, wiping a real customer's pending reminder. The prior audit examined this call site for email-bombing volume only (docs/site-audit-2026-07-29.md:341) and did not consider the content channel or the row deletion.

**Suggested fix.** Stop letting an unproven address seed mailable content. Either (a) do not store client-supplied names at all — key the intent to the resolved cart lines server-side, or store only product ids and re-resolve names from the catalogue at send time in src/lib/checkout-intents.ts:120, or (b) in recordIntent (src/lib/checkout-intents.ts:20-25) stop deleting and replacing an existing row for an address, and instead only refresh subtotal/created_at on a row this same session created. Failing both, restrict item names at src/app/checkout/actions.ts:291-301 to names that exist in the live catalogue (drop anything fetchProducts() does not know) so no free text can reach a third party's inbox.

---

### 5. [MEDIUM] A tracking-link holder can permanently exempt an unpaid order from the stale-order sweep, burning a capped promo's redemptions forever

- Actor: A (placing the orders itself) or C (holder of a forwarded tracking link)
- Location: `src/app/track/actions.ts:438`

**Exploit path.** 1. expireStaleUnpaidOrders is what releases a promo slot held by an abandoned order — its whole stated purpose (src/lib/order-cleanup.ts:20-22). It only ever touches rows where owner_note IS NULL (order-cleanup.ts:57) and where updated_at still equals created_at (order-cleanup.ts:72). 2. requestCancellationAction is token-gated only, and on the first call for an order it writes owner_note and bumps updated_at (src/app/track/actions.ts:438-444). Both of those independently and permanently disqualify the order from the sweep — clearing the note later via updateOwnerNote does not help, because updated_at no longer equals created_at. 3. Attacker places orders through placeOrder carrying a limited promo code, spreading them over future dates to dodge the daily cap and rotating arbitrary (unverified) email addresses to stay under the 5/hour-per-address cap at checkout/actions.ts:366-378. Each placeOrder response returns /track/<tracking_token>. 4. For each one the attacker calls requestCancellationAction(token) exactly once. 5. Both the pre-check in validatePromo (src/lib/promos.ts:94-103) and the locked re-assertion inside create_order_with_items (migration 0039, lines 78-86) count orders with status <> 'cancelled', so every pinned order occupies one redemption permanently. Every real customer now gets "This code has reached its limit", and nothing automated ever releases it.

**Attacker gains.** A limited promo campaign is killed for good with no self-healing path, and the bake list and dashboard carry junk orders that the cleanup job can never retire — Michelle has to cancel each one by hand from the panel to recover. The same write also lets anyone holding a forwarded tracking link pin a stranger's abandoned order open indefinitely, keeping that customer's redeemed loyalty points reserved.

**Suggested fix.** Stop letting a token-authenticated caller write the field the sweep reads as "a human was involved". Record the cancellation request in a column of its own — mirror the gift_reminder_sent_at pattern from migration 0038 with a `cancellation_requested_at timestamptz` — and have src/app/track/actions.ts:438-444 stamp that instead of owner_note, without touching updated_at (the same reasoning gift-reminders.ts:99-101 already applies). Surface it to the panel as its own badge. Then add `.is("cancellation_requested_at", null)` to the sweep's predicate only if a request should genuinely block expiry; an unpaid order the customer asked to cancel is if anything more abandoned, not less.

---

### 6. [MEDIUM] Gift self-scheduling re-prices delivery but reuses the stale free_delivery discount, cutting the food price

- Actor: A (anonymous guest at checkout) or B (signed-in customer); the buyer holds the recipient token themselves, it is printed on their own /track page by GiftShareLink
- Location: `src/app/gift/actions.ts:96`

**Exploit path.** 1. placeOrder (src/app/checkout/actions.ts:349) is POSTed directly with isGift:true, recipientScheduling:true, fulfillmentType:"delivery". Because giftSelfSchedule is true (line 474), the address block at line 480 is skipped, but input.address is still passed to resolveDeliveryFeeCents at line 494 — so the caller freely chooses the postal code used to price delivery, or omits it and gets the flat S$8. 2. promoCode is a free_delivery code. validatePromo (src/lib/promos.ts:140) sets discountCents = deliveryFeeCents, so discount_cents is frozen at the fee that applied at checkout (S$8 today, or the top distance tier once zones are configured). total = subtotal + 800 - 800 = subtotal. 3. The buyer opens /track/<trackingToken>, reads the recipient link, and calls scheduleGiftAction with the address they actually want — or simply lets the order cross the S$50 free-delivery threshold first via addItemsToOrderAction (src/app/track/actions.ts:215), which raises subtotal_cents without touching delivery_fee_cents or discount_cents. 4. scheduleGiftAction line 94 recomputes feeCents for the new postal/subtotal and gets 0, but line 96 subtracts the ORIGINAL order.discount_cents: total_cents = subtotal + 0 - 800. The free-delivery discount is now applied against food instead of the fee it was granted for. Precondition: an active promo_code row with discount_type='free_delivery'. None exists on ddwesutmtlytbcluqcuc today (only SWEET10, percent), but "Free delivery" is a first-class <option> in the admin promo form (src/app/admin/(panel)/promos/page.tsx:139), so this arms itself the first time she creates one. Same shape, larger amount, once distance tiers are configured: pick a far postal at checkout for a top-tier discount, then schedule to a near address.

**Attacker gains.** The full delivery fee (S$8 flat today, or the largest configured distance tier) taken off the price of the food, on every order, repeatable by any guest. Michelle collects a PayNow amount that is short by exactly the fee, with nothing on the order recording why.

**Suggested fix.** In scheduleGiftAction, do not carry order.discount_cents forward unchanged when the fee moves. Either re-derive the discount for free_delivery codes (read promo_code, and if its discount_type is 'free_delivery', set discount_cents = the newly resolved feeCents before computing the total), or clamp the carried discount so it can never exceed subtotal_cents + feeCents minus the same S$0.50 floor placeOrder uses. Storing the promo's discount_type on the order at insert time makes this a one-line check.

---

### 8. [MEDIUM] placeOrder applies no length or presence validation to the customer free-text fields it stores and renders

- Actor: A (anonymous, no account, no payment)
- Location: `src/app/checkout/actions.ts:390`

**Exploit path.** placeOrder validates email (line 390) and phone (line 393), re-prices every line, and bounds every quantity (line 414), but never looks at input.name, input.notes, input.giftMessage or input.recipientName. createOrder passes them straight through to create_order_with_items (src/lib/orders-db.ts:196-203), and orders.customer_name / notes / gift_message / recipient_name are unconstrained `text` on the live database (verified: no character_maximum_length, no CHECK constraint). Every other text path in the app is capped — reviews at 2000 chars, personalisation at 120, refund reason at 200, abandoned-cart item names at 80 — this one is not. Attack: POST placeOrder directly with a valid email and Singapore phone, one cheap real product, and notes filled to the Next.js server-action body limit (~1 MB). Repeat at the place-order rate limit of 12 per 5 minutes per IP, varying the email with plus-addressing so the 5/hour per-address bucket never binds. That is roughly 140 MB of attacker text per hour from a single source. The rows then land in fetchAdminOrders (src/lib/admin-db.ts:122), which pulls up to ADMIN_ORDER_LIMIT = 1000 orders with all of these columns in one shot and serialises them into the AdminStore payload for the browser; a few hundred such orders make loadAdminData too large to deliver and the panel, bake list and packing slips stop rendering. Combined with the pinning in the previous finding, nothing removes them automatically.

**Attacker gains.** Denial of the owner's only order-management tool, plus unbounded database growth, at zero cost and with no account. No money moves, but Michelle cannot see, confirm, or bake the real orders sitting in the same list.

**Suggested fix.** Validate the free text in placeOrder alongside the email and phone checks, the way createManualOrderAction already does for name: require a non-empty input.name, and trim-and-cap name, recipientName, notes and giftMessage to sane lengths (e.g. 80 / 80 / 500 / 300) before they reach createOrder, returning a plain error when they are over. Back it with CHECK (char_length(...) <= n) constraints on the orders columns so no future caller can skip the cap.

---
