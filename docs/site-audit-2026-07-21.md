# Michelle's Munchies — full site audit

Date: 2026-07-21. Method: 10-area multi-agent audit, every finding adversarially verified against the live code. Scope: consumer storefront + admin panel.

Totals: 55 confirmed (0 critical, 3 high, 11 medium, 41 low), plus items below flagged but not auto-verified.

Excluded as already-known/deferred: the delivery-fees feature (reviewed clean), migration 0030 (cost/pickup anon lockdown, pending deploy), leaked-password protection (future Pro).


## High severity (3)

### HIGH-1. Cancelled orders still flagged "paid" are counted as revenue everywhere
- Area/type: admin-operations / data-integrity
- Location: `src/app/admin/(panel)/analytics/page.tsx:51`
- Impact: Lifetime revenue, range revenue, AOV, best-sellers, pickup/delivery split, and the dashboard revenue tile all overstate income by the full value of every cancelled PayNow/manual order. Michelle's core financial view is silently wrong and there is no path to correct it.
- Fix: Exclude cancelled orders from the revenue/best-seller aggregates by filtering on `o.paymentStatus === "paid" && o.status !== "cancelled"` in both analytics/page.tsx:52 and page.tsx:63-65 (or, better, have cancelAndRefundOrder move non-Stripe paid orders out of the "paid" state on cancel).

### HIGH-2. Failed Stripe refund on cancel is silent and unrecoverable
- Area/type: admin-operations / resilience
- Location: `src/lib/admin-db.ts:316`
- Impact: A transient Stripe failure during cancel-and-refund leaves the customer's money not returned, the admin believing the refund happened, and no in-app way to retry the refund. Real money can be lost with no signal.
- Fix: When refundOrder returns false for a paid Stripe order, do not mark the order cancelled; instead return {ok:false, error:\"Refund failed, order not cancelled — retry.\"} so the cancel button stays visible and the admin can retry (or add an explicit refund-only retry action for orders stuck in payment_status=paid).

### HIGH-3. Loyalty points can be double-spent across multiple unpaid orders
- Area/type: resilience-perf-integrity / data-integrity
- Location: `src/app/checkout/actions.ts:386`
- Impact: Signed-in customers can obtain more discount than their point balance, and the ledger goes negative. Direct, repeatable money loss that scales with a customer's accumulated point balance. Becomes fully automated (no human check) once Stripe hosted checkout is live.
- Fix: At order placement (in createOrder, or before computing pointsDiscount), reserve the points by either inserting a pending negative points_ledger row tied to the order or by subtracting the sum of points_redeemed on the user's non-cancelled, unpaid orders from the available balance so the same points cannot be redeemed on a second concurrent order.


## Medium severity (11)

### MEDIUM-1. Sold-out flavour-box products stay fully addable to cart
- Area/type: storefront-browse / correctness
- Location: `src/components/product/FlavourBoxPicker.tsx:39`
- Impact: A customer viewing a sold-out flavour-box item can build a box, add it, and see a success confirmation, only to be blocked with a confusing error at checkout. It also breaks the consistent sold-out UX every other product has.
- Fix: In FlavourBoxPicker.tsx, add a !product.isAvailable check that disables the "Add box to cart" button, short-circuits add(), and renders a "Sold out" state, mirroring OptionPicker's guards at lines 88/259/262.

### MEDIUM-2. placeOrder never validates the delivery address server-side
- Area/type: cart-checkout / correctness
- Location: `src/app/checkout/actions.ts:308`
- Impact: An order can be placed for delivery with no address, stored as delivery with null address and priced at the flat (not distance) fee. Michelle has nothing to deliver to; operational failure and potential underpricing.
- Fix: In placeOrder, before computing the delivery fee, reject the order when input.fulfillmentType === 'delivery' and it is not a recipient-self-scheduling gift (input.isGift && input.recipientScheduling) unless input.address?.postalCode matches /^\d{6}$/ (and line1 is present), returning a validation error.

### MEDIUM-3. Order (and emails) created before Stripe session; a session failure orphans it and retries duplicate
- Area/type: cart-checkout / resilience
- Location: `src/app/checkout/actions.ts:436`
- Impact: Duplicate orders in the bake list/packing slips and duplicate customer+owner emails whenever Stripe checkout-session creation fails after the order is written.
- Fix: Wrap the createCheckoutSession call in actions.ts in its own try/catch (or move session creation before createOrder using pre-generated order/tracking tokens); on a Stripe failure after the order already exists, return ok:true with redirectUrl `/track/${created.trackingToken}` (the PayNow/WhatsApp fallback) instead of a generic error, so the customer is not prompted to retry and duplicate the order and emails.

### MEDIUM-4. No server-side validation that item quantity is a positive integer
- Area/type: cart-checkout / data-integrity
- Location: `src/lib/cart-resolve.ts:125`
- Impact: Order rows can be stored with negative/fractional/absurd quantities and line totals, corrupting subtotal, bake list, and analytics; the Stripe path would reject negatives but the default no-Stripe path persists them.
- Fix: In sanitizeSpecialLines (or resolveCartLines), coerce each line's quantity to a positive integer and reject anything invalid, e.g. require Number.isInteger(quantity) && quantity >= 1 (or clamp with Math.max(1, Math.min(99, Math.trunc(quantity)))) before it reaches subtotalOf/createOrder, mirroring the cart-share.ts decoder.

### MEDIUM-5. Gift self-scheduling never distance-prices delivery, undercharging on far gift deliveries
- Area/type: orders-tracking / data-integrity
- Location: `src/app/gift/actions.ts:76`
- Impact: Michelle systematically undercharges (or overcharges) delivery for the entire gift + recipient-self-scheduling flow whenever distance zones are configured. A gift to a far postal code is billed the same flat fee as a nearby one, a recurring money leak on exactly the orders where the buyer never sees the address.
- Fix: In scheduleGiftAction, after validating the recipient's postal code, call resolveDeliveryFeeCents("delivery", subtotal, postal, settings) and update delivery_fee_cents (and the persisted order total) in the same update alongside delivery_address and time_window.

### MEDIUM-6. Non-numeric input in settings number fields yields NaN, so the entire settings save fails and rolls back
- Area/type: admin-catalog-settings / validation
- Location: `src/app/admin/(panel)/settings/page.tsx:81`
- Impact: Typing a stray letter into any settings number field and clicking Save discards ALL pending settings changes and shows a cryptic 'Failed to update settings' message with no field-level indication of what went wrong.
- Fix: In buildPatch, coerce each numeric field through a safe parser that falls back to a valid number (e.g. return Number.isFinite(parseFloat(text)) ? ... : previousStoredValue) or validate all numeric fields before calling onSave and block the save with a field-level error instead of sending NaN.

### MEDIUM-7. Back-in-stock form: unlabeled email input, unannounced success, lost focus
- Area/type: accessibility / forms-labels-and-status-messages
- Location: `src/components/product/NotifyBackInStock.tsx:52`
- Impact: Screen-reader and keyboard users on sold-out products / drop waitlists cannot identify the email field, get no confirmation their subscription worked, and lose their place in the page. This is the primary conversion path for out-of-stock demand.
- Fix: Give the input an associated label (visible or via htmlFor/id or aria-label like "Email address"), and after submission keep the form mounted while rendering the success and error messages in a role="status" aria-live="polite" region and move focus to it (e.g. a tabIndex=-1 heading) so it is announced and focus is preserved.

### MEDIUM-8. Review form: unlabeled textarea and silent validation/success messages
- Area/type: accessibility / forms-labels-and-status-messages
- Location: `src/components/product/ReviewForm.tsx:92`
- Impact: Screen-reader users leaving a product review cannot identify the comment field, and receive no feedback on a blocked submission (missing rating) or a successful post, so they may repeatedly submit or assume failure.
- Fix: Give the textarea an accessible name (e.g. add aria-label="Your review" or a visually-hidden <label>) and wrap the error <p> and success <span> in a container with role="alert" / aria-live="polite" so blocked and successful submissions are announced.

### MEDIUM-9. Quick-pick add: success not announced and keyboard focus dropped
- Area/type: accessibility / focus-management-and-status-messages
- Location: `src/components/product/QuickPick.tsx:83`
- Impact: Screen-reader users get no confirmation that the item was added inside the impulse-buy quick-pick flow, and keyboard users lose their focus position within the modal, having to tab back in from the top.
- Fix: In QuickPick.tsx add `role="status" aria-live="polite"` to the confirmation container (lines 84-98) and, in an effect that runs when `added` becomes true, move focus to that container (e.g. a ref with tabIndex={-1}) so the add is both announced and keeps keyboard focus inside the dialog.

### MEDIUM-10. Non-atomic read-modify-write on stock_count allows overselling
- Area/type: resilience-perf-integrity / data-integrity
- Location: `src/lib/admin-db.ts:362`
- Impact: Tracked-stock products can be oversold and stay listed as available past zero, so Michelle takes orders she can't fulfil. Same lost-update risk on restock during concurrent cancels.
- Fix: Replace the JS read-modify-write in both decrementStockForOrder and restockOrder with an atomic Postgres RPC that does stock_count = greatest(0, stock_count - qty) (and stock_count + qty for restock) in a single UPDATE ... RETURNING, then derive is_available and low-stock alerts from the returned value.

### MEDIUM-11. Promo redemption caps count unpaid orders and race under concurrency
- Area/type: resilience-perf-integrity / data-integrity
- Location: `src/lib/promos.ts:73`
- Impact: Limited promos can be over-redeemed beyond their cap (money loss) and can be exhausted by abandoned checkouts (legitimate customers wrongly told 'this code has reached its limit').
- Fix: Enforce redemption caps atomically and against real conversions: restrict the cap COUNTs to paid orders (e.g. add `.eq("payment_status","paid")`, or move redemption recording to the paid webhook) and back the limit with a DB-side atomic guard such as a per-code redemptions counter incremented in a transaction or a unique constraint, so unpaid/abandoned orders never consume a slot and concurrent checkouts cannot both pass.


## Low severity (41)

### LOW-1. Bundle availability never surfaced on list or detail
- Area/type: storefront-browse / ux
- Location: `src/app/bundles/[slug]/page.tsx:63`
- Impact: A shopper can add a bundle that contains a sold-out item, see it succeed, and only discover the problem at checkout, where they hit a hard error with no way to fix it from the bundle page.
- Fix: Add products(is_available) to BUNDLE_SELECT, carry an `available` flag on each Bundle item (or a bundle-level soldOut boolean) through rowToBundle, and have BundleCard and AddBundleButton render a disabled 'Sold out' state when any contained product is unavailable.

### LOW-2. Whole product catalog re-fetched to show a few cards
- Area/type: storefront-browse / performance
- Location: `src/lib/products.ts:231`
- Impact: O(catalog) data and JSON transform on every home, product, and box page render. Fine at a handful of products but scales poorly and inflates the RSC payload as the menu grows.
- Fix: Add a lightweight card-scoped query (limited columns, no nested product_options, with .limit()) used by fetchFeatured, fetchRelatedProducts, and the box eligible-pool resolution instead of reusing the full fetchProducts() catalog read.

### LOW-3. generateMetadata duplicates the page's data fetch (full catalog twice for boxes)
- Area/type: storefront-browse / performance
- Location: `src/app/build-a-box/[slug]/page.tsx:13`
- Impact: Doubles catalog and detail queries plus the JS mapping on every detail-page request. Box pages pay it most heavily (two full-catalog reads each).
- Fix: Wrap the slug loaders and fetchProducts in React cache() so metadata and the page share one result per request.

### LOW-4. Sequential await waterfall on the product detail page
- Area/type: storefront-browse / performance
- Location: `src/app/menu/[slug]/page.tsx:41`
- Impact: Adds each query's latency serially to TTFB for every product view, slower than necessary especially with the extra full-catalog fetch inside fetchRelatedProducts.
- Fix: After awaiting the product, run fetchRelatedProducts and fetchStoreSettings together in one Promise.all, then run fetchReviews and getReviewContext together in a second Promise.all (guarded by settings.features.reviews), collapsing the five serial round trips to three.

### LOW-5. 'Coming soon' state computed from new Date() in a client component (hydration risk)
- Area/type: storefront-browse / correctness
- Location: `src/components/product/ProductCard.tsx:34`
- Impact: Narrow window, but around a drop's launch moment a card can render inconsistently and log a hydration warning; the add button briefly shows the wrong state.
- Fix: Compute `upcoming` deterministically for the initial render — e.g. derive it in a `useState(false)` that is set inside a `useEffect` after mount (or gate it behind a `mounted` flag) so the server HTML and first client render always agree, then let the client update the state post-hydration.

### LOW-6. Drop countdown stalls at zero and shows time in the viewer's timezone
- Area/type: storefront-browse / ux
- Location: `src/components/product/DropCountdown.tsx:24`
- Impact: A shopper waiting on a drop sees a stuck "0h 0m" and can't buy without manually refreshing; the displayed launch time can be wrong for anyone not in SGT.
- Fix: Pass timeZone: "Asia/Singapore" to the toLocaleString call, and have DropCountdown call router.refresh() (or set a boundary timeout at availableFrom) once target - now reaches zero so the buyable OptionPicker reveals without a manual reload.

### LOW-7. placeOrder does not validate timeWindow membership
- Area/type: cart-checkout / correctness
- Location: `src/app/checkout/actions.ts:343`
- Impact: A direct/forged order can bypass the per-window capacity cap or store an invalid time window that breaks slot counting and admin scheduling views.
- Fix: Add a check before the per-window cap rejecting when input.timeWindow is missing or not in settings.timeWindows.

### LOW-8. Gift self-schedule order is capacity-checked and stored against a default time window
- Area/type: cart-checkout / correctness
- Location: `src/app/checkout/page.tsx:463`
- Impact: Gift-with-self-schedule checkouts can be falsely rejected as 'time slot fully booked', and capacity counts are temporarily skewed by the placeholder window.
- Fix: When giftSelfSchedule/recipientScheduling is true, send `timeWindow` as empty/undefined from page.tsx:463 (and store `time_window` as null in orders-db.ts) so the server per-window cap check is skipped and no placeholder slot is occupied until the recipient actually schedules.

### LOW-9. Gift self-schedule: delivery fee not recomputed for the recipient's actual address
- Area/type: cart-checkout / money
- Location: `src/app/gift/actions.ts:78`
- Impact: Distance-zoned delivery pricing is bypassed for every gift-self-schedule order; far deliveries are undercharged versus a normal delivery to the same address.
- Fix: In scheduleGiftAction (src/app/gift/actions.ts), after validating the recipient's postal code, call resolveDeliveryFeeCents("delivery", subtotalCents, postal, settings), recompute total_cents accounting for existing discounts/points, and include delivery_fee_cents and total_cents in the orders update alongside delivery_address/time_window.

### LOW-10. Daily and per-window capacity checks are TOCTOU races
- Area/type: cart-checkout / correctness
- Location: `src/app/checkout/actions.ts:331`
- Impact: Under concurrent checkouts the daily/per-window order caps can be exceeded, over-booking Michelle's bake capacity.
- Fix: Enforce the caps atomically in Postgres via a BEFORE INSERT trigger (or a partial unique/exclusion mechanism) that recounts non-cancelled orders for the scheduled_date and time_window inside the same transaction and raises when the cap is reached, so the count-then-insert cannot interleave.

### LOW-11. Add-to-order writes line items before the total in a non-atomic pair; a failed total update gives free items
- Area/type: orders-tracking / data-integrity
- Location: `src/app/track/actions.ts:201`
- Impact: On a partial DB failure the customer keeps added items for free and the amount Michelle collects (shown on tracking and in the WhatsApp/PayNow handoff) is too low. There is no compensating cleanup, so the order is silently underpriced.
- Fix: Move both writes into a single Postgres RPC/transaction (or, on updErr, delete the just-inserted order_items rows by their returned ids) so the item insert and total update commit or roll back together.

### LOW-12. Order and its items are inserted non-transactionally; an items failure leaves an orphaned order
- Area/type: orders-tracking / data-integrity
- Location: `src/lib/orders-db.ts:138`
- Impact: A DB fault between the two inserts produces an orphaned, itemless order that still carries a charge and clutters the bake list. The customer's confirmation email is not sent (the throw precedes sendOrderEmails), so they have no record while a ghost order exists server-side.
- Fix: Move each order+items write into a single Postgres SECURITY DEFINER RPC (called via supabase.rpc) that inserts the order and its items inside one function body so they commit or roll back atomically.

### LOW-13. Status dropdown lets a pickup order be set to "Out for delivery", breaking tracking display and emailing a wrong status
- Area/type: orders-tracking / correctness
- Location: `src/app/admin/(panel)/orders/page.tsx:523`
- Impact: One wrong dropdown selection sends a pickup customer a nonsensical "out for delivery" email and blanks their status tracker (no step marked complete), making a valid order look stuck at the start.
- Fix: Filter the status select options to statusFlow(order) (plus the current status and the cancelled-if-cancelled case) instead of the full ORDER_STATUSES, so out_for_delivery is never offered on a pickup order.

### LOW-14. Order status tracker does not expose the current step to assistive tech
- Area/type: orders-tracking / accessibility
- Location: `src/app/track/[token]/page.tsx:199`
- Impact: Screen-reader and low-vision users cannot tell which stage their order has reached from the tracker, defeating the page's core purpose (WCAG 1.3.1 / 1.4.1, info conveyed by color and shape alone).
- Fix: Add aria-current="step" to the current-step li and include sr-only text (e.g. "Completed:", "Current step:", "Upcoming:") before each status label so assistive tech announces each stage's state instead of a flat list.

### LOW-15. No app-level rate limiting on any auth action (brute-force + email bombing)
- Area/type: accounts-auth / security
- Location: `src/app/account/actions.ts:13`
- Impact: An attacker can brute-force customer passwords, and can spam arbitrary email addresses (email bombing) via magic-link/reset. Because the store's Supabase auth SMTP has a low global hourly send cap, an attacker firing repeated magic-link/reset requests can exhaust the quota, so legitimate customers stop receiving confirmation and password-reset emails and cannot sign up or recover accounts.
- Fix: Wrap the four auth actions in rateLimit() keyed by client IP (and, for the two email-sending actions, additionally by normalized email) — e.g. a tight limit like 5 attempts/15 min for sign-in/sign-up and 3 sends/hour for sendMagicLink/sendPasswordReset — returning a generic throttled message, mirroring the existing usage in checkout/review actions.

### LOW-16. Post-login redirect ignores the `next` param and callback errors are never shown
- Area/type: accounts-auth / ux
- Location: `src/app/account/sign-in/page.tsx:29`
- Impact: Users following a deep link or a broken/expired magic link get silently dumped on the generic account or sign-in page with no feedback, causing confusion and repeat attempts.
- Fix: In sign-in and reset pages, read the next query param (via useSearchParams) and redirect there after success instead of the hardcoded /account, propagate next through sendMagicLink's emailRedirectTo, and render a friendly message on the sign-in page when ?error=auth is present.

### LOW-17. Sign-in surfaces raw Supabase error, enabling account enumeration
- Area/type: accounts-auth / security
- Location: `src/app/account/actions.ts:16`
- Impact: Leaks whether a given email address has an account on the site, aiding targeted phishing and the credential-stuffing enabled by the missing sign-in rate limit.
- Fix: In signInWithPassword, on error return a single generic constant string (e.g. "That email or password doesn't match.") instead of error.message, mirroring the anti-enumeration handling already used in sendPasswordReset.

### LOW-18. Signup can fail with an opaque DB error on referral_code collision
- Area/type: accounts-auth / correctness
- Location: `src/app/account/actions.ts:27`
- Impact: A customer who happens to draw a colliding referral code cannot create an account at all and sees an opaque error. Probability is low at bakery scale but rises with user count and has no graceful handling.
- Fix: Make the code generation collision-safe in the database — e.g., have handle_new_user generate the referral_code in a retry loop that catches unique_violation and regenerates (or add `on conflict (referral_code)` handling), so a random-code collision no longer aborts the auth.users insert.

### LOW-19. Signed-in users not redirected away from auth pages; reset page requires no re-auth
- Area/type: accounts-auth / ux
- Location: `src/middleware.ts:39`
- Impact: Minor confusion for logged-in users landing on sign-in/sign-up forms, and a password change on /account/reset requires no re-authentication, weakening protection if a session is left open on a shared device.
- Fix: In updatePassword, require the caller to re-enter their current password and verify it via signInWithPassword before calling updateUser (skippable only for a genuine recovery-origin session), and add a current-password field to /account/reset for the authenticated case.

### LOW-20. Turning off photoReviews does not hide already-submitted review photos
- Area/type: engagement-features / gating-inconsistency
- Location: `src/app/menu/[slug]/page.tsx:304`
- Impact: Owner cannot fully take down photo reviews. After disabling the feature, existing (possibly unwanted or off-brand) customer photos keep showing on every product page.
- Fix: Wrap the imageUrls block at page.tsx:304 in a settings.features.photoReviews condition (e.g. {settings.features.photoReviews && review.imageUrls.length > 0 && (...)}) so disabling the flag also hides existing review photos.

### LOW-21. Review submission trusts client-supplied image URLs with no bucket/ownership check or count cap
- Area/type: engagement-features / data-integrity
- Location: `src/lib/review-actions.ts:35`
- Impact: Any verified buyer can deface a product's review section (broken image tiles), bloat the page/storage with an unbounded number of image entries or a giant body, or point image_paths at unrelated public objects.
- Fix: In submitReview/upsertReview, before persisting, reject or drop any imageUrl that does not start with the review-images public URL prefix for a path beginning with `${userId}/`, cap the array to a small maximum (e.g. 5), and cap body length (e.g. 2000 chars).

### LOW-22. Back-in-stock notify fires on any save with isAvailable=true and ignores the backInStock feature flag
- Area/type: engagement-features / gating-gap
- Location: `src/lib/admin-db.ts:624`
- Impact: Waitlist emails can go out for a product even after the owner turns the back-in-stock feature off, and edits to already-available products trigger unnecessary notify passes.
- Fix: In updateProduct, before calling notifySubscribers, load settings and only notify when the relevant feature flag is enabled (features.backInStock or features.drops) and the product is now purchasable (availableFrom is null or in the past), ideally also only when availability actually transitioned from false to true.

### LOW-23. Back-in-stock (and newsletter) subscription accepts arbitrary victim emails with no confirmation
- Area/type: engagement-features / security-abuse
- Location: `src/lib/stock-actions.ts:37`
- Impact: Attackers can sign up other people's email addresses for stock alerts / newsletter, generating unsolicited mail and list pollution without the recipient's consent.
- Fix: Add a double opt-in: on subscribe, store the address as pending and email a one-time confirmation link (reusing tokens.ts), and only mark the stock/newsletter subscription active once that link is clicked.

### LOW-24. Manual delivery order can be saved with no address
- Area/type: admin-operations / data-integrity
- Location: `src/components/admin/NewOrderModal.tsx:90`
- Impact: A delivery order can be logged with no deliverable address and a possibly wrong (flat) delivery fee; the packing slip and driver have nothing to deliver to, with no warning shown.
- Fix: In createManualOrderAction (and mirror it in NewOrderModal before submit), when fulfillmentType === "delivery" reject the order unless address.line1 is non-empty and address.postalCode matches /^\d{6}$/.

### LOW-25. Restock on cancel never re-enables an auto-sold-out product
- Area/type: admin-operations / correctness
- Location: `src/lib/admin-db.ts:285`
- Impact: After a cancellation restores stock, the product remains unavailable to customers with no signal to Michelle that it needs manual re-enabling, quietly losing sales.
- Fix: Add a dedicated auto-sold-out marker (e.g. an auto_disabled_at column set only when decrementStockForOrder forces is_available=false at zero) so restockOrder can safely re-enable is_available for items it auto-hid without republishing manually hidden ones.

### LOW-26. Rescheduling an order sends no notification to the customer
- Area/type: admin-operations / ux
- Location: `src/lib/admin-db.ts:227`
- Impact: A customer whose bake date/time is moved by the admin is never told, so they may show up or expect delivery on the original day.
- Fix: In rescheduleOrder, after the successful update, fetch the order's email/name/tracking_token and send a reschedule notification email (mirroring the sendStatusEmail pattern, never throwing), or add explicit modal copy clarifying that rescheduling does not notify the customer.

### LOW-27. Deleting a product that belongs to a bundle fails with a raw Postgres FK error and no guidance
- Area/type: admin-catalog-settings / error-handling
- Location: `src/lib/admin-db.ts:629`
- Impact: The owner can never delete a product that is part of a bundle, and the only feedback is a cryptic database constraint string with no hint to remove it from bundles first. Looks like a broken app rather than a guardable condition.
- Fix: In deleteProduct (src/lib/admin-db.ts:629), first query bundle_items (and any other RESTRICT referrers) for the product id and, if found, throw a friendly Error naming the bundles to remove it from first; otherwise catch the FK error code (23503) and translate it to that same guidance before it reaches the UI.

### LOW-28. Product create/edit does no slug validation (format, emptiness, or uniqueness)
- Area/type: admin-catalog-settings / validation
- Location: `src/app/admin/(panel)/products/page.tsx:351`
- Impact: A product can be saved with an empty or duplicate slug, making its detail page unreachable or breaking the second product's save with an opaque 'duplicate key' error. Inconsistent with the validated merch forms.
- Fix: Add a shared validateProductInput to admin-actions.ts that rejects a blank/whitespace name and enforces the same `^[a-z0-9-]{3,40}$` slug check used for bundles/boxes, call it at the top of createProductAction and updateProductAction, and have handleSave surface the returned error instead of blindly persisting.

### LOW-29. Unsaved delivery-zone edits do not trigger the tab-close warning
- Area/type: admin-catalog-settings / ux
- Location: `src/app/admin/(panel)/settings/page.tsx:149`
- Impact: The owner can lose unsaved kitchen-postal and distance-tier edits with no warning when navigating away, unlike every other settings field which is protected.
- Fix: Have DeliveryZones register its own beforeunload listener when zonesDirty is true (or lift zonesDirty up so the parent's existing guard also accounts for it).

### LOW-30. Merch sortOrder accepts NaN and option/flavour fields accept blanks with no validation
- Area/type: admin-catalog-settings / validation
- Location: `src/app/admin/(panel)/bundles/page.tsx:213`
- Impact: A stray character in a sort-order field produces an opaque DB failure; blank/mismatched option and flavour-box configs persist and render broken or empty choices on the storefront.
- Fix: In the three merch sort-order onChange handlers wrap parsing as `const n = parseInt(e.target.value, 10); ...sortOrder: Number.isFinite(n) ? n : 0`, and in products/page.tsx handleSave filter out option groups/values with blank trimmed names and reject saving when a flavourBox is enabled but its flavourOption matches no option group or has no sizes.

### LOW-31. CSP script-src allows 'unsafe-inline' with no nonce or hash
- Area/type: security / csp-weakness
- Location: `next.config.mjs:24`
- Impact: Every visitor. If any XSS vector is introduced anywhere (product data, review content, a future dangerouslySetInnerHTML), the CSP will not stop inline script execution, so a single injection becomes full account/session compromise rather than being contained. This is defense-in-depth that is currently near-zero for scripts.
- Fix: Add nonce-based CSP: have src/middleware.ts generate a per-request random nonce, pass it via a request header, attach `script-src 'self' 'nonce-<value>'` (dropping 'unsafe-inline') in the response CSP, and set the same nonce on the JSON-LD script tags so legitimate inline scripts still run while injected ones are blocked.

### LOW-32. submitReview stores client-supplied imageUrls without validating origin, count, or length
- Area/type: security / stored-content-integrity
- Location: `src/lib/review-actions.ts:19`
- Impact: A signed-in verified buyer can pollute a product's public review gallery with arbitrary image references or bloat storage/DB with oversized arrays. Low blast radius because CSP prevents external image loads and img cannot execute script, but the persisted content is unvalidated and publicly displayed.
- Fix: In submitReview (or upsertReview), before persisting, reject any imageUrl that does not start with the review-images public bucket URL prefix, cap the array to a small max (e.g. 5) and enforce a per-URL length limit.

### LOW-33. getDayCapacityAction is unauthenticated, un-rate-limited, and queries the service-role client for any date
- Area/type: security / info-disclosure
- Location: `src/app/checkout/actions.ts:38`
- Impact: Anyone can enumerate the bakery's order volume per day and per delivery window across arbitrary dates (business-intelligence leak of how busy Michelle is), and can hammer the endpoint to drive unbounded service-role DB queries with no throttle. Low severity because only aggregate counts are exposed, not customer PII.
- Fix: Add a rateLimit() guard at the top of getDayCapacityAction (e.g. rateLimit("day-capacity", { limit: 60, windowMs: 5*60_000 })) that returns the empty capacity object when the limit is exceeded, matching the throttling pattern used by the sibling actions.

### LOW-34. Cart rows: quantity/remove controls lack per-item accessible names
- Area/type: accessibility / accessible-names
- Location: `src/app/cart/page.tsx:135`
- Impact: Screen-reader users editing a multi-item cart risk changing or removing the wrong item, and never hear the updated subtotal or 'X away from free delivery' feedback after adjusting quantities.
- Fix: Give each control a per-item accessible name (e.g. aria-label={`Decrease quantity of ${item.name}`}, likewise for increase and Remove) and wrap the Subtotal and free-delivery nudge in an aria-live="polite" region so recalculated totals are announced.

### LOW-35. Build-a-box counters not announced to screen readers
- Area/type: accessibility / status-messages
- Location: `src/components/product/BoxBuilder.tsx:102`
- Impact: Screen-reader users filling a build-your-own box get no spoken feedback on how many picks remain or when the box is complete, making the flow hard to complete without sight.
- Fix: Wrap the "X of Y chosen" progress pill in a role="status" aria-live="polite" container (or add an sr-only live region announcing remaining/completion) in both BoxBuilder.tsx (line 102) and FlavourBoxPicker.tsx (line 114) so screen readers hear the updated count and the "box complete" state as picks change.

### LOW-36. Selected option/size chips fall just below AA contrast
- Area/type: accessibility / color-contrast
- Location: `src/components/product/OptionPicker.tsx:157`
- Impact: Low-vision users may struggle to read the label of the currently-selected size/flavour, which is exactly the value they most need to confirm before adding to cart.
- Fix: Darken the selected-chip text (e.g. use a text-ink/near-black or a rose-deep-darkened token that reaches >=4.5:1 on #ffe3e8) or lighten the label to white on a rose-deep fill, in both OptionPicker.tsx:157 and FlavourBoxPicker.tsx:104.

### LOW-37. Instant add-to-cart from a product card is not announced
- Area/type: accessibility / status-messages
- Location: `src/components/product/ProductCard.tsx:130`
- Impact: Screen-reader users adding a simple item straight from a menu card get no confirmation the item entered the cart, so they may re-tap or assume the action failed.
- Fix: Add an sr-only `role="status" aria-live="polite"` span inside ProductCard that announces something like `Added ${product.name} to your cart.` when `added` is true, mirroring OptionPicker.

### LOW-38. Order row and confirmation emails are committed before the Stripe session is created
- Area/type: resilience-perf-integrity / resilience
- Location: `src/app/checkout/actions.ts:421`
- Impact: A transient Stripe failure yields orphaned duplicate orders plus a confirmation email for an order the customer believes failed; Michelle sees duplicate owner alerts and must reconcile by hand.
- Fix: Wrap createCheckoutSession in a try/catch (or move it before createOrder) so a Stripe failure after the order is committed still returns ok:true with a redirect to `/track/${created.trackingToken}` instead of a generic failure, preventing the customer from re-submitting and creating a duplicate order and second email pair.

### LOW-39. fetchStoreSettings is un-memoized and re-read multiple times per request
- Area/type: resilience-perf-integrity / performance
- Location: `src/lib/orders-db.ts:79`
- Impact: 2-3 redundant settings round-trips on every checkout, adding avoidable latency to the most latency-sensitive action. Trivially fixed by passing the already-fetched settings down or wrapping the reader in cache().
- Fix: Pass settings from placeOrder into createOrder instead of re-reading.

### LOW-40. Track page awaits three independent fetches sequentially (request waterfall)
- Area/type: resilience-perf-integrity / performance
- Location: `src/app/track/[token]/page.tsx:49`
- Impact: Extra server round-trip latency on every order-tracking page load (the page every WhatsApp/PayNow customer bookmarks and revisits).
- Fix: Wrap the three independent awaits in a single Promise.all, e.g. const [order, settings, { data: { user } }] = await Promise.all([getOrderByToken(token), fetchStoreSettings(), (await createServerSupabase()).auth.getUser()]);

### LOW-41. Order-number collisions surface as a hard failure with no retry
- Area/type: resilience-perf-integrity / resilience
- Location: `src/lib/order.ts:59`
- Impact: Low-probability but avoidable: a customer hits an order failure (and must retry, risking a duplicate) purely because two orders drew the same 4-char suffix on the same day. A retry loop on 23505 would eliminate it.
- Fix: In createOrder, wrap the orders insert in a small retry loop (e.g. up to 3 attempts) that regenerates the order number and retries when the insert fails with Postgres unique-violation code 23505 on order_number.


## Flagged but NOT auto-verified (14)

These were raised by an auditor but their verifier failed or rejected them, so treat as lower-confidence leads to check.

- [medium] `src/lib/admin-db.ts:215` — Manually marking a still-processing PayNow order paid blocks the later refund
  - Impact: A genuinely Stripe-paid order ends up with no stored PaymentIntent, so a later Cancel & refund cannot refund it via Stripe and silently falls through to the stuck-'paid' path.
- [low] `src/app/admin/(panel)/orders/page.tsx:648` — Deposit can be recorded higher than the order total
  - Impact: Admin can save a nonsensical deposit exceeding the total and the panel then shows a negative balance due, undermining trust in the deposit/balance display.
- [medium] `src/app/checkout/actions.ts:169` — Abandoned-cart lets anyone send emails to arbitrary recipients with attacker-supplied text
  - Impact: Any anonymous visitor can relay attacker-influenced email to arbitrary addresses through Michelle's trusted sending domain (spam/phishing, deliverability/domain-reputation harm), and can grief real customers by overwriting or deleting their captured checkout intents.
- [low] `src/lib/reviews.ts:160` — Review rating is not constrained to an integer
  - Impact: A crafted request can skew a product's average rating and the structured-data ratingValue exposed to search engines, and render non-integer stars.
- [low] `src/app/track/actions.ts:182` — Adding items to an existing order ignores tracked stock
  - Impact: Customers can top up an order beyond available stock of a tracked/limited item, committing Michelle to quantities she cannot bake.
- [low] `src/app/account/actions.ts:144` — Profile phone saved without validation despite existing SG phone validator
  - Impact: Invalid phone numbers persist on the profile and flow into WhatsApp/PayNow order coordination and wa.me links (toWhatsAppDigits returns null on bad input), so the owner cannot reach the customer to arrange the manual order.
- [low] `src/app/account/actions.ts:112` — Weak password policy (6-char minimum, no strength requirement)
  - Impact: Customer accounts holding order history, saved addresses, birthday, and rewards balances can be protected by weak 6-character passwords that are cheap to guess.
- [low] `src/lib/order.ts:59` — Order-number suffix uses non-cryptographic Math.random as a second factor guarding the tracking token
  - Impact: An attacker who knows a victim's email and approximate order date could, via distributed/rotated IPs, brute-force the 4-char random suffix to obtain that order's tracking token and then reschedule/cancel/modify it. Marginal in practice due to rate limiting and the required email, but the suffix should use crypto randomness (like the tokens themselves) rather than Math.random for this defense layer.
- [low] `src/lib/admin-db.ts:323` — Cancelling an order sends the customer no notification, contradicting the admin's own promise
  - Impact: Customers whose orders are cancelled (and refunded) receive no proactive email, unlike every other status transition. They may keep expecting a delivery/pickup, and the refund arrives with no explanatory message.
- [high] `src/app/admin/(panel)/settings/page.tsx:79` — Free-delivery threshold cannot be disabled and saving coerces it to 0 = free delivery for everyone
  - Impact: On a store whose threshold is still null (fresh install shows storefront $50 free-delivery), the owner opens Settings, sees 'Free delivery over S$0.00', changes anything, clicks Save, and every future delivery order silently becomes free. There is no way in the UI to represent 'no free-delivery threshold' or the intended $50 default. Direct revenue loss on every delivery order plus a misleading admin display.
- [medium] `src/lib/admin-db.ts:596` — New products never get a sort_order and there is no reorder UI, so every new product jumps to the front of the menu
  - Impact: Every newly added product sorts to position 0, ahead of established items, and ties between products all at 0 resolve in an undefined order. The owner has no way to control menu ordering at all.
- [low] `src/lib/admin-merch.ts:73` — Deleting a product silently strips it from build-a-box templates, leaving unfillable boxes
  - Impact: The storefront can present an active build-a-box whose 'pick N' count exceeds the number of eligible products, or has no products at all, so customers cannot complete the box.
- [medium] `src/lib/promos.ts:76` — Promo redemption limits count unpaid/abandoned orders
  - Impact: Legitimate customers get 'This code has reached its limit' / 'You've already used this code' from abandoned or unpaid orders; limited promos can be griefed. Business-visible under the default PayNow flow.
- [low] `src/components/product/MenuBrowser.tsx:156` — Dietary 'nut-free' filter trusts tags without cross-checking allergens
  - Impact: An allergic shopper filtering for nut-free could be shown a product that actually contains nuts if the admin tags are inconsistent; the allergen chip is the only remaining safeguard.

### Note (verified by hand)
The flagged `settings/page.tsx:79` free-delivery-threshold item IS real: computeDeliveryFeeCents / computeZonedDeliveryFeeCents treat freeDeliveryMinCents as free-when-subtotal>=threshold, and the settings form coerces a blank/0 to 0, so 0 means free delivery for every order with no way to disable it. Treat as high.
