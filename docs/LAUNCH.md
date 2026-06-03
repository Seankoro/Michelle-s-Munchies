# Launch runbook — Michelle's Munchies

The app is built, polished, and the production build is green. Going live is now **account + config
setup**, not code. Work top to bottom; each step says what to do, why, and which environment variable it
produces. Set the variables in **Vercel → Project → Settings → Environment Variables** (Production), not
in the repo. Keep secrets out of git.

Legend: ⭐ = required to launch · ☐ = optional / recommended.

---

## 0. Prerequisites

- [ ] A **GitHub** repo for this project (private). See "Back up the work" at the bottom — do this first
      so Vercel can deploy from it and nothing is lost.
- [ ] A **Vercel** account.
- [ ] A **domain** (registrar of your choice), e.g. `michellesmunchies.sg`.
- [ ] ⭐ **Decide the Supabase project.** Reuse the **current** project
      (`ddwesutmtlytbcluqcuc`) — recommended, because the schema, the 9 products, and the
      `product-images` / `review-images` storage buckets already exist there. If you instead create a
      fresh project, you must re-run every file in `supabase/migrations/` **and** update the hardcoded
      image host in `next.config.mjs` (line ~6) to the new project's hostname, or product photos won't
      load through `next/image`.

---

## 1. ⭐ Stripe — Singapore account (real payments + PayNow)

The current sandbox is **Denmark-based**, which is why PayNow doesn't appear and prices convert to DKK.
Country is fixed at account creation and can't be changed, so you need an **SG-country** account.

- [ ] Create (or use) a Stripe account whose country is **Singapore**; complete business verification.
- [ ] Copy the **live secret key** (`sk_live…`) → env `STRIPE_SECRET_KEY`.
- [ ] Dashboard → Developers → **Webhooks** → add endpoint
      `https://<your-domain>/api/stripe/webhook`, subscribe to events
      **`checkout.session.completed`** and **`checkout.session.async_payment_succeeded`**
      (the async one is how PayNow confirms). Copy the endpoint's **signing secret** (`whsec_…`) →
      env `STRIPE_WEBHOOK_SECRET`.
- [ ] In Stripe → Settings → Payment methods, ensure **PayNow** and **cards** are enabled (SGD).
- Note: the checkout uses Stripe **hosted Checkout** (redirect), so the code only needs the secret key
      and webhook secret. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is **not used today** — leave it unset, or
      set the `pk_live…` value if you want it ready for future on-page Stripe Elements.

## 2. ⭐ Resend — transactional email

The test sender `onboarding@resend.dev` only delivers to your own Resend signup address.

- [ ] Verify a **sending domain** in Resend (add the DNS records they give you).
- [ ] Set env `RESEND_FROM_EMAIL` to a sender on that domain, e.g.
      `Michelle's Munchies <orders@michellesmunchies.sg>`.
- [ ] Set env `OWNER_NOTIFICATION_EMAIL` to the inbox that should get new-order alerts (Michelle's).

## 3. ⭐ Supabase — production settings (same project)

In the Supabase dashboard for the project you chose in step 0:

- [ ] Auth → Providers → Email → turn **Confirm email ON** (so sign-ups verify ownership; it's off for
      dev).
- [ ] Auth → **URL Configuration**: set **Site URL** to your prod domain, and add
      `https://<your-domain>/auth/callback` to **Redirect URLs** (needed for magic-link, Google, and
      password-reset links).
- [ ] Auth → Passwords → enable **leaked-password protection** (HaveIBeenPwned check).
- [ ] Confirm **Google** provider is enabled, and that the Google Cloud OAuth client already lists
      `https://ddwesutmtlytbcluqcuc.supabase.co/auth/v1/callback` as an Authorized redirect URI (done
      previously; re-check if you changed projects).
- The `product-images` and `review-images` buckets are already public-read — **no action**.
- ☐ Optionally configure custom SMTP for auth emails to avoid Supabase's default low rate limits.

## 4. ⭐ Google sign-in — publish the consent screen

- [ ] Google Cloud Console → OAuth consent screen → **Publish to Production** (Testing mode only allows
      hand-added test users). Basic email/profile scopes need no verification review.

## 5. ⭐ Vercel — deploy

- [ ] Import the GitHub repo into Vercel (framework auto-detected: Next.js).
- [ ] Add **all** environment variables from the table in §9 (Production scope).
- [ ] Set `CRON_SECRET` to a long random string. The scheduled job at `/api/cron` (abandoned-cart
      reminders, birthday rewards, and seasonal-drop go-live) requires it as a Bearer token. Scheduling
      is **not** done by Vercel — its free Hobby plan only allows one cron run per day, so `vercel.json`
      was removed and an external scheduler pings the endpoint hourly instead. See §5b.
- [ ] Deploy. Confirm the build succeeds in Vercel.

## 5b. ⭐ Scheduled jobs — external hourly trigger

Vercel's free Hobby plan only permits **one cron run per day**, so the hourly schedule was moved off
Vercel (`vercel.json` was removed). The `/api/cron` endpoint is unchanged and still protected by the
`CRON_SECRET` bearer token — any scheduler that sends the header can drive it. Set up one of these (free):

- **cron-job.org (simplest):** create a cron job → URL `https://<your-domain>/api/cron` → interval
  **every 1 hour** → in the job's request/headers settings add a custom header
  `Authorization: Bearer <your CRON_SECRET>` → save & enable.
- **GitHub Actions (keeps it in the repo):** add a workflow with `on: { schedule: [{ cron: "0 * * * *" }] }`
  that runs `curl -fsS -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" https://<your-domain>/api/cron`,
  storing `CRON_SECRET` as a repo **Actions secret**. (Free-tier scheduled runs can lag a few minutes.)

Security: the endpoint returns **401** without the correct token, so the URL is safe to register
anywhere — only the secret grants access. If you later upgrade to **Vercel Pro**, you can instead restore
a `vercel.json` containing `{"crons":[{"path":"/api/cron","schedule":"0 * * * *"}]}` and remove the
external job.

## 6. ⭐ Custom domain

- [ ] Vercel → Project → Domains → add your domain; set the DNS records at your registrar.
- [ ] Set env `NEXT_PUBLIC_SITE_URL` to the final `https://<your-domain>` (no trailing slash) and
      **redeploy** — order emails, tracking links, and Stripe return URLs all use it.

## 7. ⭐ Content & store settings (in `/admin`)

Sign in to `/admin` with an account whose email is in `ADMIN_EMAILS`.

- [ ] **Products** → upload real photos; replace the seeded demo descriptions; set prices, options,
      allergens, dietary tags, stock; mark best-sellers / recommended.
- [ ] **Settings** → set real values: delivery fee, free-delivery threshold, minimum order, lead time,
      time windows, pickup location, daily order cap, per-window cap, same-day cutoff; choose which
      **feature toggles** are on; set reward rate, point value, referral points, free-gift threshold,
      birthday points, abandoned-after hours, low-stock threshold; define any structured note prompts.
- [ ] Add **promo codes**, and (if using them) **bundles**, **build-a-box** templates, and **Instagram**
      posts via their admin pages.
- [ ] ⭐ **Clear the test orders and test promo codes** from the database so launch starts clean. (Real
      orders carry `payment_status`; remove the dev/test rows.)

## 8. Flip the switch

Point people at the domain. Run the verification in §10 first.

---

## 9. Environment variable reference

Set these in Vercel (Production). `NEXT_PUBLIC_*` are exposed to the browser; everything else is
server-only. The repo's `.env.local.example` mirrors this list.

| Variable | Req? | Where it comes from | Scope |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ⭐ | Supabase → Settings → API | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ⭐ | Supabase → Settings → API | public |
| `SUPABASE_SERVICE_ROLE_KEY` | ⭐ | Supabase → Settings → API (service_role) | server |
| `STRIPE_SECRET_KEY` | ⭐ | Stripe → API keys (`sk_live…`) | server |
| `STRIPE_WEBHOOK_SECRET` | ⭐ | Stripe → Webhooks → endpoint signing secret | server |
| `RESEND_API_KEY` | ⭐ | Resend → API keys | server |
| `RESEND_FROM_EMAIL` | ⭐ | Your verified Resend sender | server |
| `OWNER_NOTIFICATION_EMAIL` | ⭐ | Michelle's inbox for order alerts | server |
| `ADMIN_EMAILS` | ⭐ | Comma-separated emails allowed into `/admin` | server |
| `CRON_SECRET` | ⭐ | A long random string you choose | server |
| `NEXT_PUBLIC_SITE_URL` | ⭐ | `https://<your-domain>` | public |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ☐ | Stripe (`pk_live…`) — unused by current code | public |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | ☐ | Upstash Redis (cross-instance rate limiting) | server |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | ☐ | Twilio (SMS/WhatsApp alerts) | server |
| `TWILIO_FROM` *or* `TWILIO_WHATSAPP_FROM` | ☐ | Twilio sender number | server |
| `OWNER_NOTIFICATION_PHONE` | ☐ | Michelle's mobile (E.164) for order texts | server |

---

## 10. Go-live verification (run on the live domain)

- [ ] Place a real end-to-end order paying by **card**, and another by **PayNow** → each redirects back,
      the **webhook flips the order to paid**, the tracking page shows it, and both the customer
      "order received" and owner "new order" emails arrive.
- [ ] Sign up with a new email (gets the **confirm-email** message), then **Google** sign-in, **magic
      link**, and **forgot-password** all work and land back on the site.
- [ ] `/admin` loads only for an account in `ADMIN_EMAILS`; a non-admin is bounced to `/admin/login`.
- [ ] Hitting `/api/cron` **without** the bearer secret is rejected (401); with it, it runs.
- [ ] Spot-check on a phone: storefront, the recommendations swipe, checkout, and the admin sidebar/drawer.

---

## 11. Recommended follow-ups (after launch)

- **SEO + social + PWA:** page metadata + Open Graph (nice link previews on WhatsApp/Instagram),
  favicon, web-app manifest ("Add to home screen"), `sitemap`/`robots`.
- **Upstash Redis:** set `UPSTASH_REDIS_REST_URL` + `_TOKEN` for rate limits shared across serverless
  instances (the code auto-detects them; no code change).
- **Twilio:** fund + configure for SMS/WhatsApp order alerts (no-ops until set).
- **Singapore features** (once the live SG Stripe business is running): PayNow-as-hero, WhatsApp-first
  ordering, postal-code delivery zones.

## Back up the work first (do this before deploying)

The project isn't in version control yet. Before pushing to Vercel: `git init`, confirm `.gitignore`
excludes `.env.local` and `.next`, make an initial commit, and push to a **private** GitHub repo. That
both protects the work and is what Vercel deploys from.
