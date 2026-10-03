# NestFind

A property marketplace for renting, buying, and finding shops, rooms and short stays.

## Run locally

Serve this folder with a static web server, for example:

```sh
python3 -m http.server 8765
```

Open http://localhost:8765. Deploy `index.html`, `improvements.js` and `improvements.css` together. The app uses the existing Supabase project; the publishable key in the browser is a public client key, not an administrative credential. Database row-level security remains essential.

## Reliability repairs

- Restore Supabase initialization and load actual active properties without fictional seed listings.
- Support UUID property links and escape text before rendering listing and conversation HTML.
- Use the Supabase session as the authority for signed-in state. Unconfirmed signup is not a signed-in session.
- Separate device-local favorites and private drafts by account; tolerate malformed or unavailable browser storage.
- Add combined price, billing-period, bedroom and property-type filters, photo navigation, and location map links.
- Validate listing prices, room counts, HTTPS photos and future viewing dates. Preserve photos while navigating a listing draft.
- Improve desktop layout, keyboard controls, focus indicators, dialog behavior, mobile zoom and labels.
- Show loading, empty and retry states for the property catalogue.

## Feature status and limitations

The public property catalogue is connected to Supabase. Sign-in, signup and listing publication use the existing database integration. Production sign-in and publishing still need a controlled test account and policy review.

Messages and viewing plans are **device-local drafts**, explicitly labelled as not sent. Owner delivery, viewing confirmation, moderation reports, notifications and subscriptions do not yet have a verified backend integration. The UI does not claim these operations succeeded. Saved properties are device-local rather than synchronized between devices.

The previous illustration of a map has been replaced in the browsing flow by location search and a property-area map link. Geolocation is not collected or inferred. Uploaded photos currently use HTTPS image links; a file-upload storage workflow is not connected.

The prior shared browser-storage keys remain untouched. The app starts new account-scoped state rather than assigning old shared messages or viewing records to the wrong account.

## Validation

```sh
node --test tests.cjs
```

12 regression tests cover startup, forged cached identity, malformed storage, account isolation, UUID links, HTML escaping, combined filters, sale pricing, unconfirmed signup, invalid prices, past dates and real-catalogue behavior. Authentication and database-write checks use mocks, not production accounts.

Browser checks against the real public catalogue: home, property detail, saved state, search and budget filtering. Layout inspected at desktop 1280×720 and mobile 390×844. No production accounts, messages, viewings or listings were created during testing.
