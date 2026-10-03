# NestFind

A property marketplace for renting, buying, and finding shops, rooms and short stays.

## Deployment branch

The production HTML at `https://emmaokoro028-coder.github.io/NestFind/` was verified against `grok-design-backup` (commit `2c0b47b`). It is newer than `main`. This repair is based on that production version and preserves its messaging, viewing requests, support chat, notifications, reporting, OTP, media upload and payment integrations.

Deploy `index.html`, `improvements.js` and `improvements.css` together. Do not deploy the older `main` version over the production branch.

## Local preview and tests

```sh
python3 -m http.server 8765
node --test tests.cjs
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

## Validation and remaining work

The regression suite uses mocked authentication and database writes. It covers session handling, account isolation, UUID handlers, injection-safe rendering, filters, pricing, invalid forms, realtime messages, preservation of live workflow entry points and premium-state handling.

Public browsing has been checked against the real catalogue. Desktop and mobile layouts are checked at 1280×720 and 390×844. End-to-end authenticated messaging, viewing acceptance, OTP email delivery, support, storage and payment flows still need controlled test accounts and private Supabase policy inspection. No production test messages, viewing requests, uploads or payments were submitted.

The existing `PAYSTACK_PUBLIC_KEY` is a placeholder. Paid listing publication and subscriptions cannot complete until the owner configures Paystack and verifies the server-side payment function/RPC. This repair does not bypass fees or payment checks. Do not put secret keys in client code.

`database-inspection.sql` contains read-only metadata queries for reviewing the private database. No database migration has been applied. Favorites are local to this browser, not synchronized between devices. Old shared browser-storage keys are left intact but are no longer used to identify a session or display another account's private records.
