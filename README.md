# Michelle's Munchies

A home bakery storefront and admin for a small Singapore baker. Customers browse the menu, build their order, and send it over WhatsApp to arrange PayNow. The owner manages products, orders, and the daily bake list from a private admin panel.

## Tech stack

- Next.js 15 with the App Router and React 19
- TypeScript
- Tailwind CSS v4
- Supabase for Postgres, Auth, and Storage
- Resend for order and account emails
- Stripe is wired in but optional, so checkout works without it
- Hosted on Vercel

## Running locally

Install the dependencies.

```bash
npm install
```

Add a `.env.local` file in the project root. Copy `.env.local.example` for the full annotated list. To browse the menu you only need `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Checkout and order management also need `SUPABASE_SERVICE_ROLE_KEY`, the admin panel needs `ADMIN_EMAILS`, and the order confirmation flow needs `WHATSAPP_NUMBER`. Resend, Stripe, and Twilio keys are optional and switch on email, card payments, and WhatsApp or SMS notifications when present.

Start the dev server.

```bash
npm run dev
```

The app runs at http://localhost:3000.

## Scripts

- `npm run dev` starts the development server
- `npm run build` creates a production build
- `npm run start` serves the production build
- `npm run lint` runs the linter

## Project layout

- `src/app` holds the routes for the storefront, the checkout and tracking flow, the account area, and the admin panel
- `src/components` holds the UI, grouped by area such as layout, product, cart, and admin
- `src/lib` holds the data access, the Supabase clients, and the business logic
- `supabase` holds the database migrations

## Deployment

The app deploys on Vercel from the main branch. Set the same environment variables in the Vercel project, then point Supabase Auth and any payment or email providers at the production domain.

Two extra steps the dashboard won't remind you about:

- Set up an external scheduler (for example cron-job.org) to GET `/api/cron` hourly with the header `Authorization: Bearer $CRON_SECRET`. It runs abandoned-cart reminders, birthday rewards, and seasonal drop notifications.
- Content lives in the admin panel: upload product photos, set store settings, and write the mascot's speech bubble line under Settings, "Michelle says". The brand images in `public/` (`logo.png`, `icon.png`, `apple-icon.png`, `og.png`) ship with the repo.
- Distance-based delivery is configured in Admin → Settings → Delivery zones (kitchen postal code + distance tiers). It requires `ONEMAP_EMAIL` and `ONEMAP_PASSWORD`; without them, delivery falls back to the flat fee.

If you point the app at a different Supabase project, `next.config.mjs` derives the image host from `NEXT_PUBLIC_SUPABASE_URL` automatically.
