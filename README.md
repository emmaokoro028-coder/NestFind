# NestFind

A property marketplace for renting, buying, and finding shops, rooms and short stays.

## Deployment branch

The production HTML at `https://emmaokoro028-coder.github.io/NestFind/` was verified against `grok-design-backup` (commit `2c0b47b`). It is newer than `main`. This repair is based on that production version and preserves its messaging, viewing requests, support chat, notifications, reporting, OTP, media upload and payment integrations.

Deploy `index.html`, `improvements.js` and `improvements.css` together. Do not deploy the older `main` version over the production branch.

## Local preview and tests

```sh
python3 -m http.server 8765
node --test tests.cjs payment-tests.cjs
```

Open http://localhost:8765. Supabase uses the existing public client configuration. Client-side checks do not replace server-side row-level security or payment verification.

## Repairs

- Fix malformed favorite-button handlers for UUID property IDs and escape listing text and attribute values.
- Fix an undefined variable in incoming realtime chat, ignore events and late responses for a previous account, and bind send completion to the original conversation.
- Avoid awaiting Supabase requests inside its auth callback. Trust actual sessions rather than a cached identity.
- Separate local favorites by account. Reload private messages, viewings, support and notifications from the server instead of sharing cached records across users.
- Do not trust cached premium timestamps as membership authority. Retain server verification and the existing payment flow.
- Replace filter placeholders with combined budget, billing period, bedroom and property-type controls; add photo navigation and area map links.
- Preserve selected media when navigating a listing draft. Validate positive prices, room counts, photos and future viewing dates before proceeding.
- Use the real public catalogue, with loading, empty and retry states, rather than fictional listings and conversations.
- Add responsive desktop layout, mobile zoom, keyboard controls, dialog focus handling, accessible labels and safer image URLs.
- Update notification read state only after the server accepts the change.

## Three-day trial and payment repair

The owner selected **3 days of free messaging, then a one-time ₦2,000 permanent messaging unlock**. The existing ₦10,000 per-listing publication fee and premium prices are retained.

The private database inspection found a different 30-day subscription system, missing legacy payment tables/publication RPC, and overly broad profile privileges. The follow-up aligns the app with the requested pricing without trusting client-side entitlements.

- `database-security-repair.sql` limits private profiles to their owner/admin, prevents client changes to admin/verification/premium fields, and restricts notification edits to read state.
- `database-payment-repair.sql` adds server-owned payment receipts, a server-calculated 3-day trial, permanent messaging activation, and publication that consumes a verified listing payment exactly once. Existing customer rows are retained. Apply the security script first: the payment script then removes the obsolete subscription requirement from viewing requests.
- `verify-paystack-payment.ts` replaces the existing Edge Function with fixed server prices, account/purpose/currency/mode checks, and atomic idempotent payment recording. It follows Paystack's server verification guidance: https://paystack.com/docs/payments/verify-payments/.
- The app uses the server entitlement result and provides payment-verification recovery to avoid asking a customer to pay twice. Trial text is consistently 3 days.

## Validation and remaining work

30 app and payment-verifier checks pass. The inspected PostgreSQL schema, policies and triggers were reconstructed in a local PGlite database. Both migrations and `database-regression.sql` passed there: 3-day and expired trial behavior, paid permanent access, repeated payment/publication safety, profile privacy, denied admin escalation, valid viewings and message read updates. All synthetic fixtures were rolled back, leaving zero test users. This local validation does not replace a controlled production-schema check.

After explicit owner approval, the combined migration/regression script passed against the production database inside a transaction ending with ROLLBACK. An additional restrictive viewing policy discovered during that check was corrected and included in both the local and production checks. The security and payment migrations were then committed, and the updated `verify-paystack-payment` Edge Function was deployed on 2026-10-04. No synthetic test users, messages, viewings or payments were retained.

Remaining payment setup:
1. Configure Paystack public key in the app and secret key only in Supabase. `PAYMENTS_MODE` must match `live` or `test`; the verifier defaults to live and refuses mismatched keys/payments. `APP_ORIGINS` must include the GitHub Pages origin.
2. Deploy `index.html`, `improvements.js`, and `improvements.css` together from the live branch after updating the review PR. Do not deploy the new app before its database/Edge Function dependencies.
3. Check OTP, authenticated messaging/viewing/media flows with controlled test accounts, then complete Paystack's test-mode verification before enabling live payments.

Existing customer records, payments, messages, viewings and uploads were preserved. The Paystack public key remains a placeholder. Favorites are local to each account on this browser. Old shared browser-storage keys remain intact but do not identify sessions or provide access to private records.
