# ShopFite

ShopFite is a responsive home goods storefront built with Next.js. It includes product search and categories, database-backed guest baskets, checkout with delivery details, Google sign-in through Supabase Auth, transactional inventory/order persistence, and Mailgun order confirmation email.

**Live site:** [shopfite-production.up.railway.app](https://shopfite-production.up.railway.app)

The Expo mobile app lives in [`mobile/`](mobile/README.md) and uses this site's `/api/products`, `/api/cart`, and `/api/checkout` endpoints.

## Stack and order flow

1. The storefront reads active products from `/api/products`. It stores the guest cart and item quantities in Supabase, keyed by a random cart ID; local storage keeps that ID and an offline fallback.
2. Google sign-in is optional; checkout also supports guest customers. Sign-in is handled by Supabase Auth and its Google provider.
3. The checkout form submits customer details and product IDs/quantities. The server never trusts prices from the browser.
4. `place_shopfite_order` in `supabase/schema.sql` locks inventory, checks stock, reads current prices, inserts the order and its line items, and decrements inventory in a single database transaction.
5. The server sends an HTML receipt through Mailgun and records whether sending succeeded. Orders are still placed if Mailgun is unavailable; `confirmation_email_sent` records `false` for follow-up.
6. Payment is currently cash on delivery. No card payment is collected or simulated.

All displayed prices and order totals use NGN. Prices are stored as integer kobo in `price_cents` / `*_cents`. Delivery is ₦120 and is free at a ₦1,500 subtotal.

## Run locally

1. Install Node.js 20 or newer and dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and fill in the Supabase and Mailgun values below.
3. In the Supabase SQL Editor, run `supabase/schema.sql`.
4. Start with `npm run dev` and open `http://localhost:3000`.

Without Supabase credentials, the product page uses a demo catalog; order submission and Google sign-in need a configured Supabase project.

## Mobile app

See [`mobile/README.md`](mobile/README.md) to install and run the Expo app on a physical iPhone or Android phone. It uses the same Google account and deployed ShopFite API.

Before cross-device account carts work, apply `supabase/migrations/202610050001_account_linked_carts.sql` to the existing Supabase project. For a fresh database, `supabase/schema.sql` includes the same account-cart setup. Add `shopfite://auth/callback` to Supabase **Authentication → URL Configuration → Redirect URLs** so Google sign-in can return to the phone.

## Supabase setup

Create a Supabase project, then run `supabase/schema.sql` in its SQL Editor. The script creates product, order, and order-item tables, safe public product reading, restricted order access, starter products, and the atomic order-placement function.

In **Project Settings → API**, copy the Project URL and anon/public key into `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Copy the service-role key into `SUPABASE_SERVICE_ROLE_KEY`; keep it on the server and never expose it in a `NEXT_PUBLIC_` variable.

In **Authentication → URL Configuration**, set the Site URL to your deployed site URL (localhost while developing), and add these Redirect URLs:

- `http://localhost:3000/auth/callback`
- `https://YOUR-DOMAIN/auth/callback`

## Google sign-in setup

1. In Google Cloud Console, select or create a project and configure the OAuth consent screen (app name, support email, audience, and scopes `openid`, `email`, `profile`). Add test users while the consent screen is in testing.
2. Create an **OAuth client ID** with application type **Web application**.
3. Add the Supabase Auth callback to **Authorized redirect URIs**. Find the exact callback URL in Supabase **Authentication → Providers → Google**; it normally looks like `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback` (use the value Supabase shows).
4. Copy the Google client ID and client secret into Supabase **Authentication → Providers → Google**, enable the provider, and save.
5. Use the site callback URLs in Supabase's URL Configuration as described above. The app starts Google OAuth with `/auth/callback`, exchanges the returned code for a Supabase session, and returns to the page where sign-in started.

Do not put the Google client secret in this project's `.env` file. It belongs in Supabase's provider settings.

## Mailgun setup

Verify a sending domain in Mailgun, configure its DNS records, and create an API key. Add the private API key, domain, and a verified From address to `.env.local`:

```dotenv
MAILGUN_API_KEY=key-...
MAILGUN_DOMAIN=mg.example.com
MAILGUN_FROM_EMAIL=ShopFite <orders@mg.example.com>
MAILGUN_API_BASE_URL=https://api.mailgun.net/v3
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

For an EU Mailgun account, set `MAILGUN_API_BASE_URL=https://api.eu.mailgun.net/v3`. In Mailgun sandbox mode, the recipient must be authorized first.

## Environment reference

See `.env.example`. Never commit `.env.local`, service-role keys, Mailgun keys, or Google client secrets. Configure the same server-side values in your hosting provider before deployment.
