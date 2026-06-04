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

Add a `.env.local` file in the project root. At minimum set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` so the app can reach your Supabase project. Resend, Stripe, and Twilio keys are optional and switch on email, card payments, and SMS when present.

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
