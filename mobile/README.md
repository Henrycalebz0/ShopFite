# ShopFite Mobile

Expo / React Native app for iOS and Android. It uses the website's existing API at `https://shopfite-production.up.railway.app` for products, carts, and checkout. Supabase Auth uses the same Google identity as the website. Signed-in phone and browser sessions share a single account cart; both refresh it about once per second while active.

## Configure

1. Apply `../supabase/migrations/202610050001_account_linked_carts.sql` to the existing Supabase project. The fresh-project `../supabase/schema.sql` already includes this change.
2. Copy `.env.example` to `.env` and set the Supabase project URL and **anon/publishable key**. Never use the service-role key in the mobile app.
3. In Supabase **Authentication → URL Configuration → Redirect URLs**, add `shopfite://auth/callback`. The Google OAuth provider and Google Cloud authorized callback remain configured as described in the root README; Google's authorized redirect is the Supabase Auth callback.

## Run on a physical phone

Install Node.js and Expo's supported Android tooling (Android Studio/SDK) or Xcode on macOS for iOS. From this directory:

```sh
npm install
npx expo install --check
npx expo run:android
# On macOS, use: npx expo run:ios
```

The first `run` creates and installs a development build on the connected phone. Start the Metro server with `npm start` after installation. Google OAuth uses the app's `shopfite://auth/callback` scheme, so test in the installed development build rather than Expo Go.

## Cross-device check

1. Open the ShopFite website and this app on a real phone. Confirm the phone can reach the deployed website API.
2. Sign in to Google on both clients with the same account.
3. Add a product on the website and open the app's bag. It should appear within about 1–2 seconds. Change its quantity in the app and confirm the website bag follows.
4. Place a cash-on-delivery test order only when a real test order is intended; checkout writes an order and decrements stock.

The phone verification must be performed on an actual iOS or Android device; an emulator or a successful build alone does not verify native OAuth deep linking or cross-device cart sync.
