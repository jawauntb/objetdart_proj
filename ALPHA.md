# ALPHA.md — Patterns to borrow from the-human-internet-{app,backend,website}

Extraction run on 2026-10-05 from Jawaun's three sibling repos: `the-human-internet` (Next.js website), `the-human-internet-app` (SwiftUI iOS), `the-human-internet-backend` (Rust Lambda + Supabase Edge Functions). Each repo's `CLAUDE.md` is the authoritative source. Items are ordered by expected ROI for *this* repo — a candlelit symbolic field instrument with a Next.js front, an iOS app at `ios/`, a `universe-mcp` library in `src/lib/universe-mcp/`, and Doppler-managed secrets.

Nothing in this doc modifies code. Pick, read the source, apply what fits.

---

## 1. The three-places-must-match pattern with pinning tests

Any cross-system contract — a SQL CHECK ↔ Swift/TS enum ↔ server lookup — needs a test that pins each half against the others, because nothing in the compiler catches drift. The trio's `SOCIAL_PLATFORMS` lives in Postgres (`is_valid_social_links()`), Swift (`SocialPlatform`), and TS (`SOCIAL_PLATFORMS`); a platform added to one but not the others silently either drops that link, or fails the whole user upsert.

Where it fits here: **the `universe-mcp` tool list and its arg shapes.** The MCP server (`src/lib/universe-mcp/`) exposes tools like `tools-inhabit`, `tools-window`, `twin`, etc. — these are a contract between the Next.js server, the iOS client (`ios/`), and any outside MCP caller. If an "inhabit" tool's shape changes in `tools-inhabit.ts` but `types.ts` or the iOS caller doesn't, the drift is silent. Pin each tool's name + param schema in a test alongside `types.ts`.

Source: `the-human-internet-app/CLAUDE.md` → "The platform whitelist lives in three places"; `VerificationPageCustomizationTests`.

## 2. Public URLs are a public API; one function serves both id generations

The-human-internet's `/[photoId]` route accepts both an 8-char Base58 short code *and* a legacy UUID through one RPC. The RPC takes `text`, regex-guards the UUID path (so a bare `::uuid` cast doesn't throw on short codes), and tests on both app and website pin the exact shape. Changing the alphabet (Bitcoin Base58, no `0/O/I/l`), the length, or the function signature breaks every link ever shared.

Where it fits here: any **shareable field reading URL** this product mints. A field reading is the product's output — it's going to leave the app in a link somewhere. Decide the URL shape *before* readings get shared in the wild, pin a test on both the Next.js route and the iOS deep-link parser.

Source: `the-human-internet/CLAUDE.md` → "`/[photoId]` is a public API"; `the-human-internet-app/CLAUDE.md` → `VerifiedPhoto.generateShortCode()`.

## 3. Decoding fallbacks: unknown value → claim *less*, never more

Any enum crossing a JSON boundary (DB → client, server → client, MCP tool response) decodes an unknown value to a declared fallback, and the fallback is chosen to claim less about the subject. In the trio: an unreadable `verification_status` decodes to `unverified`, never `verified`. A missing feature-flag row resolves `off`. This matters because old builds meet new values long before they're updated — a thrown decode in the sign-in path locks the user out of the whole app.

Where it fits here: every enum in `universe-mcp/types.ts`, every `object`/`region` identifier the iOS client decodes from the server. Pick each enum's fallback deliberately — a decoded "unknown region" should route to a safe default, not silently claim a region.

Source: `the-human-internet-app/CLAUDE.md` → `HumanUserDecodingTests` and `DatabaseEnum`.

## 4. Three-way remote feature flags: `off` / `admin` / `all` with per-flag fallback

A single `feature_flags` Postgres table with `audience text check (…)` and a client-side resolver that reads the caller's `is_admin`. `admin` is the dark-launch audience — exercise against real production state before everyone sees it. Each flag declares *its own* fallback audience (not a global default), because the safe direction depends on what the flag guards: a licensing/payment flag falls back `off`, a required-step flag can fall back `all`.

Where it fits here: experimental new field objects, new region surfaces, a toggleable archive index, or anything the product wants to A/B. Doppler already handles config-vs-secret cleanly, so flags go in Postgres, Doppler stays for secrets.

Source: `the-human-internet-app/CLAUDE.md` → "Admin role, developer menu, and feature flags".

## 5. Server-side flag resolution is the *only* binding gate

The client reads a flag to decide *what to ask for*. The server re-reads the same flag against the caller's `is_admin` and decides *what to answer*. A kill switch two independently-deployed clients (iOS + web) must honour is two switches, not one — so resolve centrally in the function/RPC that actually serves the resource.

Where it fits here: the Next.js server (which has the service role) and the iOS app (which has the user's JWT) are the two clients. If a flag gates whether a reading can be *published* or an archive query *answered*, resolve inside the server handler, not just in the UI.

Source: `the-human-internet-backend/CLAUDE.md` → `stripe-identity-session` and `stripe-identity-webhook` sections; `the-human-internet/CLAUDE.md` → "That flag is not read here, on purpose."

## 6. Trigger-guarded columns: BEFORE UPDATE revert + BEFORE INSERT force-default

RLS lets a user write their own full row, so any column that must not be user-writable (an `is_admin`, a "verified" state, a server-written reading signature) needs **both** a BEFORE UPDATE trigger that reverts the change *and* a BEFORE INSERT trigger that forces the safe default. The UPDATE guard alone leaks: a brand-new user has no row yet and the INSERT policy lets them create one with any value. Both triggers exempt `service_role` and NULL `auth.role()` (so dashboard SQL still works). A reverted write is **silent** — no error reaches the client — so document legitimate transitions explicitly in the repo's `AGENTS.md` or `DESIGN.md`.

Where it fits here: any column that encodes "this reading was produced by the real instrument, not forged in-DB" — a signature over the archive query, a timestamp from the server, a stage/truth label on a saved reading.

Source: `the-human-internet-app/CLAUDE.md` → "verification_status is write-protected" and the matching `is_admin` section.

## 7. Server-side composition for anything that *claims* something

If a user can type a claim, the claim means nothing — even inside a verified account. The trio composes the "Identity Last Verified by Stripe on {date} proving account owner is {Name}" sentence server-side from two trigger-guarded columns written only by the webhook, and withholds the whole sentence unless three independent gates all resolve on.

Where it fits here: the "field reading" IS a claim — a product that is explicitly *not* a biography relies on the composition being honest. If a reading says "you drew the lantern over the dark water on {date}", that sentence should be composed server-side from server-written fields; a user-written note belongs in a separate, visibly user-written column that the UI frames differently.

Source: `the-human-internet/CLAUDE.md` → the page-customization section; `the-human-internet-app/CLAUDE.md` → "Both verification pages state it as a sentence".

## 8. iOS shake-to-reveal dev menu, gated on `is_admin`

A `motionEnded` bridge mounted in the root view, gated on `appState.isAdmin`. Three pages: (a) **per-device** on/off switches via `UserDefaults` (so one admin's testing can't affect another's device), (b) remote feature flags (what every user gets), (c) flow triggers (manually re-run flows that normally only fire once). The per-device preference ANDs in `isAdmin` on read so a non-admin signing in on the same phone never inherits it.

Where it fits here: `ios/` already exists in this repo. A "skip archive validation", "replay last reading", "force sea-mode" dev menu accelerates testing without shipping testing-only paths to prod users.

Source: `the-human-internet-app/CLAUDE.md` → "Admin role, developer menu, and feature flags" and `DeveloperToolsTests`.

## 9. Share pipeline split by what each platform *actually accepts*

The trio does not have one "share this" button; it has five destinations each routed by a different mechanism, decided by what the platform actually accepts:
- **Reddit / X** → their own compose intents, link-only (no image), because these platforms re-encode on upload and strip any attached provenance. The link renders an Open Graph card.
- **Messages** → in-app `MFMessageComposeViewController` with the link pre-filled as body text — the one destination that accepts a caption from a third-party app.
- **Instagram / Facebook** → copy the link to clipboard, show an instructions sheet, then present `UIActivityViewController` with *just the image* — because these refuse third-party caption text. The image is handed over as a **temp file URL, not a `UIImage`**, because share extensions run memory-constrained and died on full-res in-memory images.

One file (`Sharing/ShareIntent.swift`) owns every URL shape; one test (`ShareIntentTests`) pins every form including the strict percent-encoding of the nested link.

Where it fits here: when a field reading is shareable (Twitter card? iMessage link preview?), decide the per-platform mechanism before shipping one generic share sheet.

Source: `the-human-internet-app/CLAUDE.md` → "Sharing" section; the sibling-repo website owns the Open Graph card in `opengraph-image.tsx`.

## 10. Security-definer RPCs instead of blanket anon-readable table policies

Rather than making a table anon-readable (which lets anyone *enumerate* every row), expose a `security definer` function granted to `anon` that only ever answers about *one* row whose code the caller already holds. The function withholds non-public fields based on owner state and feature flags, all resolved server-side.

Where it fits here: a shared field reading surface on the web. The anon key must not be able to list every reading ever made — only the one at the shared code.

Also known traps when debugging anon access: (a) **RLS does not bypass RLS** — an `EXISTS` subquery against `public.users` from inside an `anon` storage policy returns zero rows and silently fails, because `anon` has no SELECT on `users`. Use a security-definer helper for the cross-table check. (b) **`storage.buckets` has its own RLS**, no `anon` policy by default — `createSignedUrl` fails with a misleading `Object not found` before it ever reaches the object-level check. (c) When debugging, test *as* the role: `set local role anon; select …`.

Source: `the-human-internet/CLAUDE.md` → "Anonymous access is narrower than it looks".

## 11. Deletes: DB row first, storage object second

The row is what public read paths read. Deleting the row *first* is what actually kills the public surface. The storage cleanup is best-effort; a failed object delete leaves an orphan — strictly better than a dangling live surface pointing at nothing. Don't reverse the order, and treat batched deletes the same way.

Where it fits here: deleting a saved reading, removing an archive entry, any user-initiated purge.

Source: `the-human-internet-app/CLAUDE.md` → "Deletes go DB row first, Storage object second".

## 12. Image cache opts in via a flag, not always-on

The trio's `RemotePhotoImage(isThumbnail:)` opts into a shared downsampled cache (600px cap) — grid cells need it because a `LazyVGrid` destroys and recreates view identity on scroll, so without it re-scrolling a 50-item grid re-downloaded and re-decoded everything at full resolution. Full-resolution contexts (detail, verification page) deliberately don't participate: they're single long-lived views with nothing to cache, and they need the real pixels. The cache is keyed by storage path alone — so a *provisional* / in-flight asset must not enter it (it would outlive the final asset at that key).

Where it fits here: whatever grid of saved readings / objects / regions the iOS app renders, if that grid grows past ~20 items.

Source: `the-human-internet-app/CLAUDE.md` → `RemotePhotoImage`.

## 13. One `hydrate(userID:)` method as the source of truth for sign-in

Both cold-launch (session restored from Keychain) and fresh sign-in call it. The trio used to have two copies that drifted — only one fetched photos, neither special-cased a returning fully-onboarded user. Collapsing fixed it. If you touch sign-in/session logic, keep it one method.

Where it fits here: `ios/`'s auth bootstrap. If there are currently two paths that initialize the user's state, collapse them.

Source: `the-human-internet-app/CLAUDE.md` → "`AppState.hydrate(userID:)` is the single source of truth".

## 14. CI secrets must never run on `pull_request` (above all `pull_request_target`)

A public repo whose deploy job holds signing / Doppler / Vercel / API secrets must not expose them to arbitrary PR branch code. PR-time CI (tests, lint, type-check) belongs in a *separate*, secret-free workflow. This matters immediately if this repo turns public.

Also useful: `git push` to an `https://` origin without credential helpers fails with `could not read Username for 'https://github.com': Device not configured`. Push via the SSH form instead when `gh` is already SSH-authenticated.

Source: `the-human-internet-app/CLAUDE.md` → "Shipping (TestFlight)" four-point rule and the "Push over SSH" dev note.

---

## Non-obvious infrastructure notes worth keeping within reach

- **Supabase Edge runtime (Deno) `crypto.subtle.verify` doesn't implement ECDSA P-384 + SHA-256.** The trio's App Attest verifier originally used WebCrypto for both the chain and the assertion — passed every local Deno test, then 500'd every real request. Use `@noble/curves` for both; keep a test that stubs `crypto.subtle.verify` to throw and requires the verifier to still pass. If this repo ever adds any ECDSA verification in a Supabase Edge Function, this bites. (`the-human-internet-backend/CLAUDE.md` → "`_shared/appAttest.ts`".)
- **UUIDs: Swift uppercases, Postgres lowercases.** An RLS policy that compares `storage.objects.name` to `auth.uid()::text` as *text* silently rejects every upload. Cast to `uuid` for a type-correct comparison, and lowercase defensively on the client.
- **Supabase's passkey registration requires an already-authenticated non-anonymous user**, which conflicts with a passkey-first signup flow. The trio pivoted to Sign in with Apple's `signInWithIdToken` for exactly this reason. If this product's iOS auth is still "to be decided", that's prior art.
- **Dropping a client-written column that's being replaced by a server-written one requires a graveyard period.** PostgREST rejects unknown columns with PGRST204, so until no build in the wild writes `old_column`, keep it alive (unused on the read path) alongside the new one. (`the-human-internet-app/CLAUDE.md` → "`display_first_name`/`display_last_name` are dead".)

---

## How to use this doc

Treat each numbered item as a candidate, not a prescription. Start with the items that protect against *silent* failures (3, 5, 6, 10, 11, 12) before the ones that protect against *loud* ones. The right first move is usually: read the referenced source section in full → look at the one or two files that implement it → decide whether the invariant actually binds here yet.

Written by Claude on 2026-10-05 from the state of the three sibling repos on that date.
