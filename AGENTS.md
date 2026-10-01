# ShopFite Agent Guide

This file is the working map and change policy for agents modifying ShopFite. Follow it together with the user's current request and higher-priority platform/developer instructions. The user's explicit instructions take precedence over this file.

## Project at a glance

- Next.js 15 App Router, React 19, TypeScript, and handwritten CSS.
- Supabase is the persistence layer for products, guest carts, orders, and order lines. Do not switch to Neon or another database unless the user asks.
- Supabase Auth handles optional Google OAuth. Checkout also supports guests.
- Mailgun sends order confirmation email.
- Checkout is cash on delivery. Do not claim card processing exists or simulate payment success.
- Currency is NGN. Integer fields named `*_cents` store kobo (100 kobo = ₦1).
- Free delivery starts at ₦1,500; otherwise delivery is ₦120. The database RPC is the source of truth for this calculation.

## Source map

| Path | Responsibility |
| --- | --- |
| `app/page.tsx` | Client storefront, category/search controls, Google sign-in entry, basket UI, local fallback, and product rendering. |
| `app/checkout/page.tsx` | Guest/Google checkout form, delivery details, basket summary, order submission, and success state. |
| `app/globals.css` | Responsive storefront and checkout styling. |
| `app/layout.tsx` | Root document and metadata. |
| `app/api/products/route.ts` | Reads active products from Supabase; falls back to the demo catalog if unavailable. |
| `app/api/cart/route.ts` | Reads and saves a guest basket via Supabase. The browser's random cart UUID and local copy are convenience/fallback state; Supabase is the persistent cart store. |
| `app/api/checkout/route.ts` | Validates customer/cart input, calls the atomic order RPC, sends the Mailgun receipt, and records whether email sending succeeded. |
| `app/auth/callback/route.ts` | Exchanges the Supabase OAuth authorization code for a session and redirects back to the app. |
| `lib/products.ts` | Product type, demo fallback catalog, and NGN formatting helper. |
| `lib/supabase/browser.ts` | Browser Supabase client. It uses only the public anon key. |
| `lib/supabase/server.ts` | Server Supabase client. It uses the private service-role key; never import this module from client code. |
| `supabase/schema.sql` | Fresh-project schema, row-level security, grants, transactional cart/order functions, and starter products. |
| `.env.example` | Names and non-secret examples for required environment settings. |
| `README.md` | Human setup guide for Supabase, Google Cloud OAuth, Mailgun, and local development. |

## Runtime flows

### Product browsing and basket

1. The home page requests `/api/products` and uses the demo catalog only if that request fails.
2. A random UUID identifies each guest basket. The app stores the ID and an offline fallback in browser local storage.
3. Basket reads and writes go through `/api/cart`; server-side Supabase credentials access `shopping_carts` and `shopping_cart_items` through `save_shopfite_cart`.
4. Product prices shown in the browser are informational. Checkout never trusts a browser-supplied price.

### Checkout and order persistence

1. The checkout UI sends customer details and product IDs/quantities to `/api/checkout`.
2. Zod validates the request shape and bounds.
3. `place_shopfite_order` locks product rows, checks active status and inventory, reads current prices, creates the order and order lines, decrements inventory, and calculates delivery in one database transaction.
4. Payment method is `pay_on_delivery`; the app does not collect payment credentials.
5. If order persistence succeeds, email delivery is attempted. Email failure must not undo a saved order. `orders.confirmation_email_sent` records the outcome.
6. Never tell a customer an order was not saved just because Mailgun failed. Avoid asking them to place a duplicate order; distinguish order status from email status.

### Google sign-in

1. Browser code calls Supabase OAuth with Google and redirects to `/auth/callback`.
2. Google Cloud's authorized redirect URI is Supabase's provider callback (`https://<project-ref>.supabase.co/auth/v1/callback`); the exact value is displayed in Supabase Auth → Providers → Google.
3. Supabase's Site URL/Redirect URL allowlist must include each app origin's `/auth/callback` route (for example localhost and the deployed domain).
4. Google client secrets belong in Supabase provider settings, never in `.env.local` or browser code.

## Safe change process

1. Read the relevant source and this guide before editing. Keep changes within the requested feature and preserve existing behavior outside its scope.
2. Keep secrets, credentials, customer data, and API responses with sensitive values out of source files, logs, screenshots, and final messages. `.env.local` is ignored by Git; do not commit it or print its values.
3. `NEXT_PUBLIC_` variables are public. Only the Supabase URL and anon key belong there. The service-role key and Mailgun API key must remain server-side.
4. Keep privileged database access on server routes. Never expose order/cart tables or service-role credentials to browser code. Preserve row-level security and the restricted grants in `supabase/schema.sql`.
5. Treat browser data as untrusted: validate request bodies, recalculate totals from database prices, constrain quantities, and use parameterized Supabase calls/SQL.
6. Database changes must keep the bootstrap schema accurate. For an already-deployed database, prefer a new ordered migration under `supabase/migrations/` and update `supabase/schema.sql` for fresh installs; do not silently remove or rewrite customer/order data.
7. Keep Mailgun failures observable without logging API keys, full message bodies, or unnecessary personal information. Sandbox recipients must be authorized in Mailgun before delivery.
8. Update `README.md` when setup variables, providers, routes, persistence behavior, order flow, or payment behavior changes.
9. Keep UI responsive and accessible: labels for inputs, useful button names, visible errors, keyboard-operable controls, and clear loading/success states.
10. Do not add dependencies without a concrete need. Keep `package.json` and `package-lock.json` synchronized when dependency changes are required.

## Authorization and security boundary

- The user authorizes agents to make the reversible, in-repository changes needed to fulfill an explicit ShopFite task. Do not ask again for routine edits, documentation updates, or read-only inspection that are already within that task.
- This is not blanket authorization to deploy/publish, spend money, create or delete external resources, alter production data, send arbitrary communications, expose customer information, or perform destructive actions. Do those only when explicitly requested and allowed by platform approval rules.
- If the platform requires approval for network access, elevated execution, or a destructive operation, request that approval through the supported mechanism. Never bypass or weaken a security boundary to avoid asking.
- Never broaden database grants, disable RLS, make private keys public, or add a secret to a client bundle to make a failing integration appear to work.
- Before any production database mutation, migration, or email resend, identify the target and expected effect; preserve order and inventory integrity and avoid duplicate orders.

## Local setup and operation

- Use Node.js 20 or newer.
- Install dependencies with `npm install`.
- Copy `.env.example` to `.env.local`, then fill settings using `README.md`. Set `NEXT_PUBLIC_SUPABASE_URL` to the project root URL (for example `https://<project-ref>.supabase.co`), not the REST path `/rest/v1`.
- Run `supabase/schema.sql` in the Supabase SQL Editor for a fresh project.
- Start the app with `npm run dev`. Use the port printed by Next.js if the default port is occupied; callbacks must be allowlisted for the chosen origin when using Google OAuth.
- Never paste real secret values into this guide. Keep examples clearly fake.

## Checks and reporting

- Follow the current user's request and applicable higher-priority instructions for whether to run checks. Do not add or run tests unless the user asks for testing/verification or a higher-priority instruction requires it.
- When reporting a change, state what changed, what was checked (if anything), and any remaining setup dependency such as missing external credentials or dashboard configuration.
- Distinguish a fallback/demo catalog from Supabase-backed data and distinguish an order saved in Supabase from a confirmation email queued by Mailgun.
