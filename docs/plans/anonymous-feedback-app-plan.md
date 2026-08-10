# said — implementation & distribution plan

**An anonymous-honesty app: every day, people from your contact list tell you what your
flaws are, and you find out someone from your school said it.**

Status: plan only. Nothing in this document is implemented. It is written to be handed to
a build agent and a review agent; the adversarial checklist at the end is for the reviewer.

Working name: **said** (the notification reads "someone from Westview said…"). Alternates
held in reserve: *ick*, *fr*, *roast*. Naming is a marketing decision, deferred to §16;
nothing in the architecture depends on it.

---

## 1. What we are actually building

The apparent object is an app where people anonymously tell you your flaws. The operative
object is different, and getting it right decides everything downstream: **the product is
the feeling of being talked about, delivered safely.** Nobody opens Gas eight times a day
because they love complimenting classmates; they open it because somewhere in there is
information about *themselves* held by people they know, and the app meters it out. The
flaw framing is our sharpened version of the same hook — negative information about
yourself from people who actually know you is the single highest-curiosity object on a
phone. That is the asset. It is also the liability: every app that shipped this exact
asset without constraints is dead, banned, or fined.

So the design problem is precise: **maximize curiosity about anonymous negative signal
while structurally preventing the three failure modes that killed every predecessor** —
free-text cruelty (platform ejection), curiosity exhaustion (the novelty cliff), and
deanonymization (trust collapse). The whole plan is downstream of that sentence.

One more framing note before the analysis. This category produces comets, not planets:
tbh went from launch to #1 to acquired to shut down inside 14 months; Gas launched August
2022, hit #1, reportedly cleared ~$7M in revenue, sold to Discord in January 2023, and
was shut by November 2023. The honest plan is not "we will be the exception" — it is
"we will build the retention experiments that might make us the exception, while
monetizing the peak as if we won't be." Both tracks are in this document.

---

## 2. Comparative analysis: the engagement physics of social apps

The user-facing question every social app answers is "why open me right now?" There are
only a handful of load-bearing answers, and every app below is a configuration of them:

- **Variable-ratio reward** — the slot machine schedule. Feed apps refresh content;
  graph-curiosity apps refresh *opinions about you*. The second is rarer and stronger
  per-pull, but its supply is finite (your graph's opinion-refresh rate), where TikTok's
  supply is infinite (the world's content). This single asymmetry explains why TikTok is
  a planet and Gas was a comet.
- **The curiosity gap** — withheld information you are certain exists. "Someone picked
  you" with the sender hidden is the purest form ever shipped. It is also depletable:
  each reveal narrows the candidate space, and after enough cycles you roughly know who
  thinks what. Hint economies (Gas's God Mode) monetize the gap and *accelerate* its
  depletion — revenue and retention trade against each other by design.
- **Social stakes** — content about identifiable people you know. Yik Yak had anonymity
  and locality but weak identity (posts about the dining hall, not about you). tbh made
  the stakes personal and the polarity positive. We make the stakes personal and the
  polarity honest. Stakes scale engagement and risk together, linearly.
- **Appointment + streak mechanics** — BeReal proved a daily ritual can bootstrap a
  habit and also proved a ritual without a curiosity payload decays: once the streak is
  the only reason to open, the streak *is* the product, and streaks fatigue. Ritual is a
  delivery schedule, not a reason.
- **Creation burden** — the quiet killer. Most social apps die because 1% create and
  99% lurk, and a contacts-graph app has no exogenous creator class to import. The poll
  ballot was Bier's structural solution and it is the most important mechanic in this
  entire plan: **answering a poll is consuming for the voter and creating for the
  target.** Content supply becomes a byproduct of content demand. Zero creation burden,
  ever. We inherit this wholesale.

### The case table

| app | identity | graph | polarity | composition | outcome | the lesson that survives |
| --- | --- | --- | --- | --- | --- | --- |
| tbh (2017) | anon → hinted | school contacts | positive only | structured polls | #1, ~2.5M DAU in weeks, acquired by Facebook, shut 2018 | polls delete the creation burden; school waterfall works; positivity was an App-Store survival constraint, not a moral one |
| Gas (2022) | anon → paid hints | school contacts | positive only | structured polls | #1, ~$7M reported, sold to Discord, shut 2023 | the hint subscription monetizes curiosity without unmasking; scarcity cadence (capped sessions, cooldowns) stretches finite supply |
| Sarahah (2017) | anon | link-shared | unconstrained | free text | removed from both app stores for bullying | free text + anonymity + real identity targets = ejection. no moderation layer survives this combination |
| NGL (2021–) | anon | IG story link | unconstrained | free text | FTC + LA DA settlement 2024: $5M, banned from minors; sent fake AI messages and charged for useless hints | never fabricate messages; never sell hints that don't resolve; regulators now treat this category as pre-tagged |
| Yik Yak (2013) | anon | geo (campus) | unconstrained | free text | campus bans, threats, shut 2017 | locality without identity produces mob dynamics; anonymity needs a persistent-consequence layer |
| Formspring / ASKfm | anon | profile link | unconstrained | free text | linked to teen suicides, collapsed | the worst outcome in the category is not churn, it is a dead kid and your name in the coverage. this is the floor the safety section is built over |
| Secret (2014) | anon | contacts | unconstrained | free text | shut 2015, money returned | even adult professional graphs curdle; "friends' secrets" becomes "gossip about you" in one hop |
| BeReal (2022) | real | friends | neutral | photo ritual | 73M peak, retention collapse, sold to Voodoo | appointment mechanics without a curiosity gap decay in ~9 months |
| Poparazzi (2021) | real | contacts | positive | photos of friends | shut 2023 | creation burden on the *other* person doesn't scale either; the ballot remains the only solved supply model |
| Instagram / TikTok | real / creator | interest | mixed | free, moderated at scale | planets | infinite exogenous supply + interest graph = durable; nothing contacts-scoped achieves this, so don't pretend the plan does |

### The four death mechanisms, and what this plan does about each

1. **Platform ejection.** Every unconstrained-negativity app was removed, banned, or
   fined. The pattern is exact: free text is the vector. Verdict: **there is no free
   text in the core loop.** All negative signal is chosen from a curated,
   severity-graded prompt catalog. A sender can only say what we have decided is
   sayable. This converts moderation from an impossible read-everything problem into a
   catalog-curation problem, which is small, human, and winnable. (§4, §11)
2. **Curiosity exhaustion.** tbh and Gas both faded when the reveal economy depleted.
   Mitigations, honestly graded: rotate the prompt catalog daily so the *question*
   refreshes even when the graph doesn't (medium confidence); widen the graph on a
   schedule — school → rival schools → city (medium); the glow-up arc, which converts
   one-shot reveals into longitudinal self-tracking, the only mechanic in this plan
   with a chance at planet-grade retention (low confidence, highest upside). (§4.6)
3. **Deanonymization collapse.** One credible "I figured out who said it and it started
   a fight" story ends trust. Defenses are structural, not policy: k-anonymity floors on
   every hint, randomized delivery delay to break timing correlation, aggregation before
   display, hint suppression under small candidate sets. (§4.5)
4. **Dogpile catastrophe.** The Formspring floor. A coordinated pile-on must be
   *mechanically impossible*, not just against the rules: per-recipient daily caps on
   edge-severity deliveries, anomaly detection on prompt×target spikes, and a recipient
   kill-switch. A person can have a bad day on this app; they cannot have a life-ruining
   week, because the delivery layer won't transmit one. (§11)

### What descends into design law

The analysis compresses to ten laws. Every product decision below cites them; the build
agent should treat a violation the way this repo treats a red contract test.

- **L1 — No free text in the core loop.** Structured prompts only. Free text exists
  solely in moderated side channels (prompt suggestions, display names), all of which
  pass a moderation gate before any human sees them.
- **L2 — The mixed deck.** Flaws are the headline; they are never the whole meal. Each
  12-ballot session carries at most 4 edge-severity prompts, at least 4 warm ones. On
  the delivery side, no recipient ever receives two edge hits without a cushion between
  them. The app is called honesty, and honesty includes the good news.
- **L3 — Consumption is creation.** The ballot is the only content mechanism. No
  composer, no feed, no chat. (Chat is a moderation surface we refuse to own.)
- **L4 — Scarcity cadence.** Capped sessions, cooldown timers, one daily drop. Finite
  supply is stretched, never binged.
- **L5 — The notification is the product.** Push copy is designed before screens are.
  The app is the place you go after the push already delivered the feeling.
- **L6 — Curiosity is monetized, never resolved for free and never faked.** Hints cost;
  hints are real; full unmasking is never sold at any price. (NGL sold fake resolution
  and got a consent decree. We sell narrowing, honestly labeled.)
- **L7 — Negative signal is private, always.** No leaderboards of flaws, no public
  counts, no "most roasted." Recipients may share their own results; the app never does.
- **L8 — Real messages only.** No bot votes, no seeded fake picks, no "someone might
  have said…" Zero exceptions, including growth emergencies. This is the one law with a
  regulator already attached.
- **L9 — Recipient sovereignty.** Category mutes, per-prompt hide, blind sender-blocking
  (block without knowing who), full opt-out, and non-user opt-out honored at the
  delivery layer.
- **L10 — Plan for the comet.** Monetization live before the growth wave, not after.
  Retention experiments run *during* the peak, when there is traffic to learn from.

---

## 3. Product overview

One sentence: **a daily ballot game where friends anonymously pick who among four
contacts a prompt describes — warm ones and honest ones — and the picked find out
someone from their school said it.**

### The core loop, from both seats

**As voter** (this is where time is spent): open from push → a session of 12 ballots →
each ballot is one prompt plus four names from your school/contacts → tap one (or
shuffle, twice max, or skip) → sound + haptic + next → session ends, cooldown timer
starts (60 min), coins accrue per answer. Twelve taps, ninety seconds, done.

**As target** (this is why you come back): push arrives — *"someone from Westview
said…"* → open → the mirror shows the prompt ("…you interrupt people"), when, and the
free hint tier (e.g. "a junior"). A paid hint narrows further (first letter of their
name, once the k-floor allows). The daily 8pm drop aggregates the day: "3 people said
this, 1 person said that." You screenshot the one that's funny, post it to your story,
and three of your contacts install the app.

### Screens (complete list — there is no more app than this)

1. **Onboarding** — phone OTP → name → DOB gate → school picker (geo-sorted) → contacts
   permission (value-framed: "this is how polls about you find you") → notification
   permission (primed after first ballot, not before) → first session immediately.
   Time-to-first-ballot target: under 60 seconds.
2. **Ballots** — the session player.
3. **Mirror** — the inbox of things said about you: item view, hint chips, daily-drop
   digest, the glow-up tab (§4.6).
4. **Share** — auto-generated story-format cards, recipient-initiated only (L7).
5. **You** — streaks, coins, subscription state, mutes/blocks/opt-outs, school.
6. **Paywall** — the receipts subscription (§12).

No feed. No profiles beyond name/school/year. No DMs. Every screen not on this list is
scope creep and the reviewer should flag it.

---

## 4. Product mechanics in detail

### 4.1 The prompt catalog

The catalog is the editorial heart of the product and the whole of its safety story.
Prompts are written in-house, versioned in Postgres, and graded:

- **polarity**: `warm` / `neutral` / `edge`
- **severity**: 1–5 within polarity. Edge severity 1 is "is always late"; severity 3 is
  "talks over people"; severity 4–5 ("thinks they're smarter than everyone") ships only
  to 18+ cohorts and only after the recipient has edge-tolerance history (has kept
  edge-3 items without muting the category).
- **category**: habits / social / ego / reliability / style / talk — the mute
  granularity (L9).
- **fixability**: every edge prompt must name a *behavior*, not an *attribute*. "You
  interrupt people" is in; "you're annoying" is not; anything touching body, appearance,
  race, sexuality, family, poverty, disability, or immutable identity is permanently
  out. This is the bright line that separates the product from Sarahah, and it is
  enforced at catalog authorship, not at runtime — runtime never sees a prompt that
  wasn't hand-approved.

Launch catalog: ~150 warm, ~100 neutral-funny, ~80 edge (severity 1–3). Daily deck
assembly (per L2): 12 slots = 4 warm + 4 neutral + up to 4 edge, personalized by a
ranking job (§7) and rotated so no prompt repeats for the same voter within 7 days.

Users may *suggest* prompts (the one free-text field in the app). Suggestions go through
the Modal moderation gate, then a human, then the catalog. Nothing user-written is ever
shown to another user unreviewed (L1).

### 4.2 Ballot assembly

Four names per ballot, drawn from: same-school members (weighted by contact-graph
closeness), direct contacts on the app, and at most one non-user contact per session
(picked non-users generate an invite hook — "you were picked in a poll" — delivered only
via the voter's own share action, never by us texting a non-consenting number; TCPA is
not a growth channel). Shuffle re-draws names, twice per ballot. The assembly job
enforces exposure fairness: nobody appears in more than ~40 ballots/day school-wide, and
edge-prompt exposure is capped per person per day *before* votes happen, so the pile-on
defense starts at ballot assembly, not at delivery.

### 4.3 Delivery

Votes do not deliver instantly. Warm/neutral picks deliver after a randomized 15–90
minute delay (timing-correlation defense, §4.5). Edge picks deliver only in the 8pm
daily drop, aggregated ("2 people said…") whenever count ≥ 2, and are subject to the
per-recipient edge cap: **max 3 edge deliveries per person per day, max 8 per week**,
excess silently dropped (not queued — a queued insult is a scheduled one). The cushion
rule (L2) orders the drop: warm, edge, warm.

### 4.4 Hints and the receipts economy

Free tier per pick: school year + "vibe" (a coarse bucket: someone you've matched in
polls before / new). Paid tier (subscription, §12): gender if the sender opted into
having one on profile, year + first letter of first name — **only when ≥5 candidates in
the school share that letter** (the k-floor). One "super hint" per week narrows to two
candidates *with the sender's consent*, requested anonymously ("someone wants a closer
look at a pick you made — allow?"). Consent-gated narrowing is the only mechanic that
can approach unmasking, because the mask's owner holds it. Full identity is never
purchasable (L6).

### 4.5 The anonymity architecture (product face)

- **k-floors everywhere**: any hint that would leave a candidate set smaller than 5 is
  suppressed and the UI says so ("too few people match this — hint locked").
- **Timing**: randomized delays and drop-batching break "we were both on our phones"
  correlation.
- **Aggregation**: edge items prefer counted display over itemized display.
- **Small-graph mode**: users with <12 in-app contacts get warm/neutral decks only —
  a 6-contact graph cannot keep an edge pick anonymous, so we don't pretend it can.
- **Blind blocking**: "never let this person pick me again" from any mirror item,
  without revealing who it was. The block applies at ballot assembly.

### 4.6 The glow-up arc (the retention bet)

Weekly, the mirror computes deltas: "talks over people: 3 picks last week → 1 this
week," rendered as a private trendline. Optionally, the recipient can flag a flaw as
*working on it*, which quietly raises that prompt's frequency in their school's decks
for two weeks — a self-directed measurement. This is the one mechanic that converts the
app from a slot machine into an instrument, it is the App Store review narrative
("anonymous feedback for self-improvement, with consent and controls"), and it is the
only idea in this document with planet-grade upside. It is also unproven, which is why
it ships in v1 behind an experiment flag rather than as the headline.

### 4.7 Streaks, coins, share cards

Answer-streaks (voter side) gate nothing critical but decorate the You screen; coins
(earned per session) buy shuffles and one extra session per day. Share cards are
story-aspect images generated server-side: recipient-initiated, flaw-cards watermarked
with the app name and a deep link. The card *is* the ad (§16); the recipient posting
their own roast is high-status self-deprecation and the single strongest organic loop
available to us.

---

## 5. Platform verdict: Expo (React Native), not Swift

Swift buys native polish and costs a second codebase the moment Android matters — and in
this category Android matters at wave 2, when a school's Android minority can't install
and the graph tears. The deciding argument is iteration speed on the loop: **EAS Update
ships JS-layer changes over the air in hours**, and this product lives or dies by tuning
push copy, deck composition, cooldown lengths, and paywall placement *during* a growth
wave, not in next week's App Store review cycle. Bier's teams shipped tbh's first
version in weeks and tuned daily; that cadence is only available to us in Expo.

Concretely:

- **Expo SDK (current), TypeScript, expo-router** for navigation.
- **Custom dev client** (not Expo Go) from day one — we need `expo-contacts`,
  `expo-notifications`, `expo-haptics`, `expo-apple-authentication` (reserve),
  RevenueCat's native module, and App Attest/Play Integrity for device attestation.
- **EAS Build + Submit** for binaries; **EAS Update** for the JS layer; update channel
  per campus cohort so a deck experiment can target one school.
- Known risk, stated: iOS 18's limited-contacts picker lets users share a subset of
  contacts, thinning the graph. Mitigation is a value-framed permission screen, a
  "your polls will be emptier" education state, and the school directory as fallback
  ballot supply. Track grant-rate as a first-class metric from day one.
- When to eject to native: only if ballot animation frame rates or haptic latency
  measurably hurt session completion. No other native itch justifies the fork.

## 6. System architecture

Everything hosts on **Railway**; burst/ML compute goes to **Modal**. No other vendors
except Twilio (OTP), RevenueCat (IAP), and Apple/Google push.

```
                    ┌─ Railway ────────────────────────────────┐
  Expo app ── HTTPS ┤  api        Node 20 + Fastify (REST)     │
      │             │  worker     BullMQ consumers + cron      │
      │             │  Postgres   primary store                │
   APNs/FCM ◀───────┤  Redis      queues, rate limits, cache   │
                    └──────────────┬───────────────────────────┘
                                   │ signed service tokens
                    ┌─ Modal ──────┴───────────────────────────┐
                    │  moderation   LLM gate for all free text │
                    │  graphjobs    nightly: closeness ranks,  │
                    │               school inference, dogpile  │
                    │               anomaly scan               │
                    │  deckranker   prompt-ranking model +     │
                    │               push-copy bandit training  │
                    └──────────────────────────────────────────┘
```

- **api** — stateless Fastify service; JWT auth; Zod-validated routes; talks to Postgres
  and Redis; enqueues everything slow. Scales horizontally on Railway replicas.
- **worker** — BullMQ consumers: vote delivery scheduling, daily-drop assembly at each
  local 8pm (per-timezone cron fan-out), push dispatch, share-card rendering
  (`@vercel/og`-style satori rendering server-side), RevenueCat webhook processing,
  contact-graph ingestion.
- **Postgres (Railway)** — the one database (per the brief). Single primary at launch;
  `pgbouncer` in transaction mode in front of it from day one; the `events` table is
  partitioned by month from the first migration so analytics writes never bloat the OLTP
  path. Migration path if a wave outgrows it: read replica for analytics, then peel
  events off to ClickHouse — but that is a wave-3 problem and is deliberately not built
  now.
- **Redis (Railway)** — BullMQ, sliding-window rate limits, session-cooldown state,
  hot deck cache.
- **Modal** — three Python apps, each a web endpoint + scheduled functions:
  - `moderation`: every free-text field (names, school suggestions, prompt suggestions)
    passes through an LLM classifier (Claude Haiku class) with a rules layer; returns
    allow / review / block. Called synchronously by api with a 500ms budget and a
    fail-closed default (text held for review on timeout).
  - `graphjobs`: nightly batch — contact-graph closeness scores (mutual-contact
    weighting), school-membership inference for users who skipped the picker, dogpile
    anomaly detection (prompt×target spike scan over 24h windows → auto-suppress +
    human review queue).
  - `deckranker`: weekly training of the prompt-ranking model (which prompts drive
    session completion and recipient retention rather than mutes) and the push-copy
    bandit (Thompson sampling over template variants; api reads back a static policy
    table — no model call in any request path).
- **Environments**: `staging` and `prod` Railway environments from the same repo;
  `railway.json` per service; secrets in Railway variables; Modal secrets mirrored via
  `modal secret`.

## 7. Data model (Postgres)

DDL sketch — canonical enough to build from, terse enough to review. All `id` are
`bigint generated always as identity` unless noted; all tables get `created_at
timestamptz not null default now()`.

```sql
-- identity
create table users (
  id            bigint primary key generated always as identity,
  phone_hash    bytea unique not null,        -- HMAC-SHA256(phone, server key)
  phone_last4   text not null,                -- support/debug display only
  display_name  text not null,
  dob           date not null,
  gender        text,                          -- optional, self-declared; hint tier only
  school_id     bigint references schools(id),
  class_year    smallint,
  state         text not null default 'active' -- active|paused|deleted|banned
);

create table auth_sessions (
  id bigint primary key generated always as identity,
  user_id bigint not null references users(id),
  refresh_token_hash bytea not null,
  device_id bigint not null references devices(id),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create table devices (
  id bigint primary key generated always as identity,
  user_id bigint references users(id),
  platform text not null,                      -- ios|android
  attestation_state text not null default 'unverified',
  push_token text,
  tz text not null default 'America/New_York'
);

-- graph
create table schools (
  id bigint primary key generated always as identity,
  name text not null, city text, region text, kind text,  -- college|high
  lat double precision, lng double precision,
  wave smallint,                               -- launch-wave number, null = unopened
  unlock_threshold int not null default 300,
  status text not null default 'waitlist'      -- waitlist|open|paused
);

create table contacts (
  id bigint primary key generated always as identity,
  owner_id bigint not null references users(id),
  phone_hash bytea not null,
  name_given text,                             -- as it appears in owner's book
  matched_user_id bigint references users(id),
  unique (owner_id, phone_hash)
);

create table opt_outs (                        -- non-users and users alike
  phone_hash bytea primary key,
  scope text not null default 'all',           -- all|ballots|invites
  source text not null                          -- web_form|sms|support
);

-- catalog
create table prompts (
  id bigint primary key generated always as identity,
  text text not null,
  polarity text not null,                      -- warm|neutral|edge
  severity smallint not null default 1,
  category text not null,
  min_age smallint not null default 13,
  status text not null default 'draft',        -- draft|live|retired
  author text not null default 'staff'
);

-- the loop
create table ballot_sessions (
  id bigint primary key generated always as identity,
  voter_id bigint not null references users(id),
  deck jsonb not null,                         -- ordered prompt_ids + slot polarity
  completed_at timestamptz
);

create table ballots (
  id bigint primary key generated always as identity,
  session_id bigint not null references ballot_sessions(id),
  prompt_id bigint not null references prompts(id),
  choice_user_ids bigint[] not null,           -- the four names shown
  shuffles smallint not null default 0
);

create table votes (
  id bigint primary key generated always as identity,
  ballot_id bigint not null references ballots(id),
  voter_id bigint not null references users(id),      -- never exposed; see §11
  picked_user_id bigint not null references users(id),
  prompt_id bigint not null references prompts(id),
  deliver_after timestamptz not null,          -- randomized delay / drop batching
  delivery_id bigint references deliveries(id) -- null until delivered or dropped
);

create table deliveries (                      -- what the recipient actually sees
  id bigint primary key generated always as identity,
  recipient_id bigint not null references users(id),
  prompt_id bigint not null references prompts(id),
  vote_count int not null default 1,           -- aggregation (L2/edge)
  kind text not null,                          -- instant|daily_drop
  seen_at timestamptz, shared_at timestamptz
);

create table hints (
  id bigint primary key generated always as identity,
  delivery_id bigint not null references deliveries(id),
  tier text not null,                          -- free|paid|super
  payload jsonb not null,                      -- {year:…} / {first_letter:…}
  k_at_grant int not null                      -- candidate-set size when granted
);

-- money
create table subscriptions (
  id bigint primary key generated always as identity,
  user_id bigint not null references users(id),
  rc_entitlement text not null, status text not null,
  current_period_end timestamptz
);

-- safety
create table reports (
  id bigint primary key generated always as identity,
  reporter_id bigint not null references users(id),
  delivery_id bigint references deliveries(id),
  reason text not null, state text not null default 'open'
);
create table blocks (
  blocker_id bigint not null references users(id),
  blocked_vote_source bigint not null,         -- resolved sender id, stored blind
  primary key (blocker_id, blocked_vote_source)
);
create table mutes (
  user_id bigint not null references users(id),
  category text not null,
  primary key (user_id, category)
);
create table moderation_actions (
  id bigint primary key generated always as identity,
  subject_user_id bigint, object_type text, object_id bigint,
  action text not null, actor text not null, note text
);

-- growth + measurement
create table invites (
  id bigint primary key generated always as identity,
  inviter_id bigint not null references users(id),
  channel text not null,                       -- share_card|picked_hook|link
  token text unique not null,
  redeemed_by bigint references users(id), redeemed_at timestamptz
);
create table streaks (
  user_id bigint primary key references users(id),
  current int not null default 0, best int not null default 0,
  last_day date
);
create table experiments (key text primary key, spec jsonb not null);
create table experiment_assignments (
  user_id bigint not null references users(id),
  key text not null references experiments(key),
  variant text not null, primary key (user_id, key)
);
create table events (                          -- partitioned by month
  id bigint generated always as identity,
  user_id bigint, name text not null, props jsonb,
  at timestamptz not null default now()
) partition by range (at);
```

Two schema-level laws the reviewer should verify survive implementation: **no API
response object ever contains `votes.voter_id`** (deliveries and hints are the only
read models for recipients), and **`contacts.phone_hash` is HMAC'd with a server-side
key**, so a database dump alone cannot be joined against a rainbow table of phone
numbers. Raw numbers exist only transiently in the OTP flow and are never persisted.

## 8. API surface

REST, versioned under `/v1`, JWT bearer auth, Zod schemas shared with the client via a
generated types package.

```
auth      POST /auth/otp/request        {phone}            → sends code (Twilio Verify)
          POST /auth/otp/verify         {phone, code}      → {access, refresh} + user upsert
          POST /auth/refresh            {refresh}          → rotated pair
onboard   PUT  /me                      {name, dob, gender?, school_id, class_year}
          POST /me/contacts             {entries:[{hash, name}]}   (batched, ≤2000)
          GET  /schools?lat&lng&q                          → geo-sorted picker
          GET  /schools/:id/waitlist                       → count vs threshold
loop      GET  /sessions/next                              → deck or {cooldown_ends_at}
          POST /sessions/:id/votes      {ballot_id, picked_user_id | skip | shuffle}
          POST /sessions/:id/complete
mirror    GET  /mirror                                     → deliveries, paginated
          GET  /mirror/:id                                 → item + available hint tiers
          POST /mirror/:id/hints        {tier}             → hint or k-floor refusal
          POST /mirror/:id/share                           → share-card URL
          POST /mirror/:id/report       {reason}
          POST /mirror/:id/block                           → blind block
safety    PUT  /me/mutes                {categories:[…]}
          POST /me/pause                                   → stop all deliveries
          DELETE /me                                       → deletion pipeline (§11)
          POST /optout (unauthenticated, web)  {phone}     → non-user opt-out
money     POST /webhooks/revenuecat                        (server to server)
misc      POST /prompts/suggest         {text}             → moderation gate → queue
          POST /push/token              {token, platform}
```

Rate limits (Redis sliding window): OTP request 3/hour/number and 10/day/device; votes
bounded by session structure; hints 30/day; contact upload once per 6h. Every write
route is idempotent under a client-supplied `Idempotency-Key` because teens on school
wifi will retry everything.

## 9. Authentication & identity

- **Phone OTP via Twilio Verify** — the only identity primitive. No passwords, no
  email. Apple Sign-In is reserved as a review-appeasement fallback but not primary
  (the graph is phone numbers; an Apple relay email matches nothing).
- **Age gate**: DOB at onboarding; under-13 hard-refused (COPPA); 13–17 permitted in
  high-school cohorts *only when* the softened deck ships (see §16 — launch is
  college-first, 18+, and the App Store rating at launch is 17+); the DOB check
  gates deck severity and hint tiers server-side, never client-side.
- **Tokens**: 15-minute access JWTs, rotating refresh tokens bound to a device row;
  refresh reuse detection revokes the family.
- **Device attestation**: App Attest / Play Integrity verdict stored on the device row.
  Unattested devices can browse but not vote — vote-farming from emulators is how a
  rival school poisons a leaderboard week, and it's cheap to shut the door early.
- **One account per number, one active device per account** (Gas's rule; it keeps
  ballot-stuffing expensive and support simple).

## 10. Notifications

Written first, per L5. Template classes, each with bandit-tested variants:

- **the pick** (to targets): "someone from {school} said…" — the prompt is *withheld*
  from the push for edge items (curiosity + lock-screen safety: a parent glancing at a
  lock screen must never see "your flaw"), included for warm ones.
- **the drop** (daily 8pm local): "your mirror is ready — {n} people said things today."
- **the session** (to voters, cooldown expiry, max 2/day): "new polls about your
  friends just dropped."
- **the streak save** (once, 21:30 local, only if streak ≥ 3).
- **transactional**: hint results, subscription events.

Hard caps enforced in the dispatch worker, not in callers: max 3 pull-class pushes per
user per day, quiet hours 22:30–08:00 local (drop moves inside a school's schedule
grid — lunch and 15:10 are the tbh-era slots and still correct), all copy variants live
in a table the bandit reorders weekly. A push that doesn't move D1 open-rate in its
cohort gets retired by the data, not by taste.

## 11. Trust, safety, and legal — the section that keeps the app alive

The category's regulator history: Sarahah removed from both stores; NGL under an FTC
consent decree (fake messages, deceptive hints, marketing to minors); Yik Yak banned
from campuses; Formspring in the suicide coverage. Everything below is designed against
that record, and half of it is already embedded in the mechanics above (structured
prompts L1, delivery caps §4.3, k-floors §4.5, blind blocks L9).

**App Store survival (Guideline 1.2, UGC):** report on every delivery, block on every
delivery, category mutes, published contact, moderation SLA < 24h. The rating at launch
is 17+; the review notes lead with the glow-up framing, the fixability rule, the caps,
and the absence of free text — reviewers reject the Sarahah shape on sight, so the
submission must demonstrate, screen by screen, that this is not that shape.

**The moderation stack, top to bottom:** catalog curation (nothing sayable that wasn't
authored) → ballot-assembly exposure caps → delivery caps + cushion ordering → Modal
anomaly scan (dogpile auto-suppression) → user reports → human review queue (staffed
from day one of the beta; the founder is the first moderator) → moderation_actions audit
log. A **self-harm tripwire**: mutes of every edge category at once, a pause, or a
deletion within an hour of an edge delivery surfaces a resources interstitial (crisis
line, "hide this week's mirror") — quietly, without ceremony, and logged for review.

**Honesty with the user about anonymity's limits:** the privacy policy and the first
edge delivery both state it plainly — senders are anonymous to *recipients*, not to
*us*, and unlawful use (threats, targeted harassment) can be actioned and, under legal
process, disclosed. NGL taught the category that pretending otherwise ends in a consent
decree; saying it plainly is also what makes blind-blocking and dogpile enforcement
credible.

**Data protection:** contacts HMAC'd (§7); deletion pipeline completes within 30 days
and cascades to contacts rows where the user is `matched_user_id`; non-user opt-out
honored at ballot assembly (§8 `/optout`); data-retention: raw events 13 months, votes
indefinitely but sender-pseudonymized after 12 months (voter_id replaced by a
non-reversible cohort key — old picks stop being subpoena-relevant while aggregates
survive). GDPR/CCPA access + deletion via support at launch, in-app by wave 2. TCPA: we
never SMS non-users; invite delivery is always the user's own share sheet.

**The two absolute rules, restated because a growth-stressed team will be tempted:**
no fabricated messages ever (L8), and no sale of full identity ever (L6). Either one,
once, is the company.

## 12. Monetization

**receipts** — the God Mode descendant, priced honestly:

- Subscription: launch A/B at **$4.99/wk vs $6.99/wk vs $14.99/mo** through RevenueCat;
  Gas's reported numbers say weekly wins with teens, monthly wins with college — we're
  college-first, so the monthly arm matters.
- Includes: paid hint tier on every delivery (year + first letter under k-floor), 2
  super-hint requests/week (consent-gated, §4.4), see-who-viewed-your-shared-card,
  double coins.
- One-time IAPs: coin packs (shuffles, extra session). No ads at any point — ads on
  negative content about minors-adjacent users is a brand-safety fire and a distraction.
- Paywall placement: after the second hint tap, never before the first — the first
  taste of curiosity is free or the loop never starts.
- Targets, stated so the reviewer can attack them: 3–5% subscriber conversion at wave
  peak (Gas's reported band), ARPPU ~$20/mo, refund-rate < 5% (NGL's deceptive-hint
  refunds are the cautionary metric — our hints must feel worth it or L6 is failing).

## 13. Analytics & experimentation

- **PostHog Cloud** (free tier carries the beta) for product analytics + feature flags +
  session funnels; the `events` table in Postgres is the durable copy and the input to
  Modal jobs. One write path: client → api → both sinks.
- Canonical metrics, one definition each, in a `metrics.md` the whole team cites:
  - activation: completed first session within 10 min of install
  - D1/D7/D30 retention by cohort and by school-wave
  - K-factor = invites-sent-per-user × invite-conversion, measured per school per week
  - polls/DAU, session-completion rate, shuffle rate (deck-quality proxy)
  - mirror-open latency after push (the product's true pulse)
  - mute rate and pause rate per prompt (catalog kill signals — any edge prompt whose
    7-day mute rate exceeds 8% is auto-retired)
  - school penetration = members / estimated enrollment; the S-curve per school
- Experiments run through `experiment_assignments` with PostHog flags as the delivery
  mechanism; every mechanic flagged in this doc (glow-up, price arms, push variants,
  deck ratios) is an experiment key from day one.

## 14. Build plan

Two engineers (or one plus agents), one designer-hybrid, ~11 weeks to waterfall start.

| phase | weeks | ships | exit test |
| --- | --- | --- | --- |
| M0 skeleton | 1–2 | Expo app: OTP auth, onboarding, contacts sync, school picker; api+worker+Postgres+Redis on Railway staging; hardcoded 40-prompt deck; ballots→votes→instant warm deliveries; push | founder's own contacts play a full loop on TestFlight |
| M1 the real loop | 3–4 | full catalog + deck assembly, delivery scheduling (delays, daily drop, caps, cushions), mirror + free hints, streaks/coins, share cards, mutes/blocks/reports, Modal moderation gate | a 30-person friendly beta sustains 5 days of daily drops with zero manual intervention |
| M2 money + armor | 5–6 | RevenueCat + receipts + paywall, paid hints with k-floors, super-hint consent flow, dogpile scan + review queue, deletion + opt-out pipelines, attestation, App Store review dry-run against §11 checklist | a hostile internal test (two accounts colluding to deanonymize a third; a scripted pile-on) fails to break k-floors or caps |
| M3 closed beta | 7–10 | one college campus (§16 wave 0), EAS Update iteration on deck/copy/cooldowns, glow-up flag on for 50%, price test | D1 ≥ 55%, D7 ≥ 25%, K ≥ 0.8 within the campus; mute rate declining week over week |
| M4 waterfall | 11+ | wave launches per §16; scale worker + replicas as needed | §16 gates |

Deliberately not in v1: Android (wave 2, when a campus's Android share starts costing
K), web, DMs (never), custom free-text polls (never, L1), leaderboards of people (never,
L7 — school-vs-school leaderboards only).

## 15. Cost model (monthly, order-of-magnitude)

| stage | Railway | Modal | Twilio | other | total |
| --- | --- | --- | --- | --- | --- |
| beta (1 campus, ~2k users) | ~$40 | ~$30 | ~$150 (3k verifies) | PostHog/RevenueCat free tiers | **~$220** |
| wave (10 campuses, ~50k users) | ~$300 (replicas, bigger PG) | ~$150 | ~$2,500 | ~$100 | **~$3k** |
| peak (500k users) | ~$1.5–3k | ~$500 | ~$15k† | ~$1k | **~$20k** |

† OTP is the scaling cost. Mitigations at peak: silent device re-auth (verify once per
device, not per session), SMS fallback to WhatsApp OTP where cheaper, and Twilio volume
pricing. Revenue at peak (say 300k MAU × 3% × $20 ARPPU ≈ $180k/mo) covers this ~9×;
the beta is a rounding error on a personal card.

---

## 16. Marketing & distribution — the Bier playbook, applied

First, the playbook itself, compressed from how tbh and Gas actually launched (his
essays and talks; paraphrased, not quoted):

1. **Distribution is a product feature, not a department.** The share card, the "you
   were picked" hook, and the waitlist counter are engineering tickets, not campaigns.
2. **Teens (and freshmen) first, always** — densest social graphs, highest status
   sensitivity, fastest word-of-mouth, and physically co-located so one school can hit
   saturation. An app that spreads person-by-person dies; an app that spreads
   school-by-school compounds.
3. **Launch one school at a time, and make the school the unit of scarcity.** The
   waitlist page shows *your school's* count against its threshold. Nobody can use the
   app until enough of their actual friends can — which converts every waitlisted kid
   into a recruiter.
4. **The value must land in seconds, before identity forms.** First ballot inside 60
   seconds of install; first "someone picked you" within the first day or the install
   was wasted (deck assembly deliberately over-serves brand-new users as targets —
   with warm prompts only; nobody's first-ever mirror item is a flaw).
5. **Paid acquisition is a confession.** If K < 1 with organic, ads are renting a
   graph that will churn. Budget for wave marketing: ambassador cash and stickers,
   under $1k/campus.
6. **Press is a lagging indicator.** Decline early coverage; the app should be a rumor
   before it's a story. (The rumor *is* the story TechCrunch eventually writes.)
7. **If a screen needs explaining, it's dead.** The whole app must be legible from one
   screenshot of a share card.

### Why college-first, when the pitch says "your school"

The user's one-liner — *someone from your school said you're X* — works verbatim on a
campus. Launching flaws-content into high schools first triples the legal surface
(minors + parents + districts), forces the softened deck immediately, and hands local
news a "new bullying app" frame before we have a safety track record. Colleges give us:
18+ users (17+ App Store rating stays honest), native roast culture, dorm-density
graphs as tight as any high school's, and the Fizz/Yik-Yak-revival GTM precedent.
**Verdict: wave 0–2 are colleges. High school expansion is a deliberate later decision
that requires the softened (severity ≤ 2) deck, a 13–17 policy review, and a safety
record to point at.** If the owner wants high schools first anyway, that is an explicit
override of this plan's riskiest call, and the reviewer should treat it as such.

### The waterfall, wave by wave

- **Wave 0 (one campus, weeks 7–10).** Pick a single mid-size university — big enough
  for anonymity floors (>8k undergrad), small enough to saturate, not in our own
  network's backyard (we want data, not friends being nice). Seeding: 5–8 paid campus
  ambassadors ($100 + merch each, paid on verified-signup milestones) recruited from
  club officers and the people who run the campus meme account — school-famous beats
  internet-famous, every time. They seed the waitlist link in GroupMes, club Discords,
  and stories. Unlock at 500. Launch on a Sunday at 8pm — the drop lands when the
  campus is in bed scrolling.
- **Wave 1 (weeks 11–14): +4 campuses**, selected for adjacency — schools with heavy
  cross-enrollment friendships and sports rivalries with wave 0 (the contact graphs
  overlap, so wave-0 users pre-seed wave-1 waitlists without being asked). Add the
  campus-vs-campus leaderboard (participation counts only — L7 keeps people off
  leaderboards, schools are fair game).
- **Wave 2 (weeks 15+): metro clusters**, Android ships, and the gate discipline: a
  new campus opens only while every open campus holds D7 ≥ 25% and the newest cohort's
  K ≥ 1.1. Opening campuses to mask churn is how comets *choose* to be comets — the
  waterfall pauses when the gates fail, and the team works retention until they pass.

### The content engine

- **The share card is the ad.** Server-rendered, story-aspect, the prompt big, the app
  name and a campus-tagged deep link small. The recipient posting their own roast is
  self-deprecating status — the strongest ad format teens have ever produced for
  anyone, and it's user-initiated so it's credible.
- **TikTok organic, zero spend:** the format is *reaction* — "reading what my contacts
  said my flaws are." Ambassadors film the first ones; the format is self-replicating
  because the reaction is genuine (we've built the one app whose content makes your
  face do something on camera). Provide an in-app "record your reaction" affordance
  that watermarks and never shows sender info.
- **Push copy is marketing.** "someone from {school} said…" does more acquisition via
  lock-screen glances in a dining hall than any ad buy. Copy variants are the bandit's
  job (§10); the growth team's job is writing new variants weekly.
- **No launch press, no influencers with agencies, no paid installs.** Revisit only if
  a wave stalls with K ∈ [0.9, 1.1] — the narrow band where a small push can tip a
  campus over saturation threshold.

### Growth math the team steers by

K = (invite surfaces shown per user) × (send rate) × (invite conversion). The three
factors get separate dashboards; "raise K" is never a goal, raising one named factor
is. School penetration follows an S-curve: below ~10% of enrollment the ballots feel
empty (choices are strangers), above ~20% it tips — deck assembly's job in the empty
zone is to lean on direct contacts and freshmen dorms (highest mutual density), and
the waitlist threshold exists precisely so no campus ever launches into the empty
zone. Watch mirror-latency above all: the median hours between install and first
"someone picked you" predicts D7 better than any other number we can move.

## 17. Risks, ranked, with the comet plan

| risk | likelihood | severity | standing answer |
| --- | --- | --- | --- |
| curiosity exhaustion → comet decay | high | high | L10: monetize before peak; glow-up + catalog rotation experiments run during the wave; §17a decision tree |
| a dogpile incident becomes the story | medium | fatal | caps are mechanical (§4.3, §11); incident runbook: suppress, contact, retire prompt, publish the postmortem ourselves |
| App Store rejection at 1.2 review | medium | high | §11 checklist in review notes; glow-up framing; if rejected, appeal with the caps demo video, then soften edge deck one severity tier |
| deanonymization scandal | medium | high | k-floors + timing defense + small-graph mode; bounty an internal red-team attack every wave (M2 exit test, repeated) |
| FTC / state AG attention | low-medium | high | L6 + L8 are absolute; honest-anonymity disclosure (§11); no minors at launch |
| contacts grant-rate collapse (iOS limited picker) | medium | medium | school directory fallback; grant-rate as first-class metric; value-framed permission screen |
| clone with more money (this category is cheap to copy) | high | medium | speed and catalog taste are the moat, which is to say the moat is thin — another reason for L10 |
| Twilio cost spike / SMS-pumping fraud | medium | low | Verify fraud guard, per-country blocklist, device re-auth |
| Railway Postgres ceiling at peak | low | medium | pgbouncer + partitioned events from day 1; replica/ClickHouse path pre-planned (§6) |

### 17a. The comet decision tree (decided now, while nobody's emotional)

At peak-minus-one-month (first week the newest wave's D7 undershoots the gate):
1. If glow-up cohort D30 ≥ 1.5× control → the retention bet is live; raise a round or
   fund from revenue, pivot the brand toward the instrument (self-improvement graph),
   expand decks and age bands deliberately.
2. If not, and revenue ≥ ~$150k/mo → run it as a cash comet: freeze features, tune
   paywall, and open acquisition conversations from strength (the Gas exit) while DAU
   still charts up.
3. If neither → shut the waterfall, keep open campuses running at maintenance cost,
   and take the graph + catalog + engine to the next product. The codebase in this
   plan (ballot engine, delivery layer, anonymity architecture) is deliberately
   product-agnostic below the catalog.

---

## 18. Adversarial review checklist — for the reviewing agent

Instructions to the reviewer: your job is to break this plan, not to improve its prose.
For each item, produce either a concrete failure scenario (inputs → mechanism → bad
outcome) or an explicit "holds, because…" with the load-bearing assumption named.
Anything you can't falsify or confirm, mark unresolved — do not average. Attack the
highest-severity items first.

**Growth & retention math**
1. Recompute the wave-0 funnel backwards: 500-person waitlist → what install rate,
   activation rate, and D1 does the plan *require* for the campus to tip past 10%
   penetration before ballots feel empty? Is that consistent with the M3 exit gates?
2. The plan claims deck assembly can carry the sub-10% "empty zone" using direct
   contacts. Estimate median in-app contacts for user #50 at a 8k-undergrad campus.
   Does a 4-name ballot fill with people they know? If not, where does the plan lie?
3. Find the circular dependency in §16's gate discipline: waves pause on D7 < 25%, but
   D7 partly depends on graph density that new waves would provide. Is there a
   deadlock state? What breaks it?
4. Attack the K-factor decomposition: which of the three factors does *nothing in this
   plan actually move*? Name the missing lever.
5. BeReal's decay curve applied here: model month-6 DAU if the glow-up experiment
   fails and catalog rotation only slows exhaustion by 2×. Does the comet plan's
   revenue window (§17a-2) actually overlap the decay curve?
6. The mirror-latency claim (§16, "predicts D7 better than any other number") is
   asserted, not evidenced. What experiment in M3 would validate or kill it, and is
   that experiment actually in the plan?

**Anonymity attacks (be the adversary literally)**
7. Process-of-elimination: I have 6 in-app contacts, small-graph mode gives me
   warm-only decks — but do *others* with big graphs get ballots containing me, and
   can my warm deliveries still be correlated? Trace a concrete deanonymization with
   two colluding accounts and the free hint tier (year + "vibe").
8. The "vibe" hint bucket ("someone you've matched in polls before") leaks
   interaction history. Construct the attack; propose the minimum redaction.
9. Timing: delivery delays are 15–90min randomized, but the *cooldown* is exactly 60
   minutes and sessions are push-triggered. Can a recipient who controls when a
   suspect votes (e.g., hands them the phone, watches them play) beat the jitter?
10. First-letter hint + public class roster + k-floor of 5: for how many
    (letter, year) cells at a 2k-person school does the floor actually bind? Is 5 the
    right k, or does the roster make it 10?
11. The super-hint consent flow notifies a voter that "someone wants a closer look at
    a pick you made." Does the *notification itself* leak (timing, which pick)? Can a
    voter be socially pressured to consent in person ("everyone consent so we see who
    didn't")?
12. Database subpoena scenario: what exactly can be produced about a 19-year-old's
    votes from 8 months ago under the §11 retention rules? Is the pseudonymization
    schedule (12 months) consistent with the stated harassment-enforcement promise?

**Safety**
13. Construct a pile-on that stays *under* the caps: 3 edge/day × 7 days = 21 hits of
    "talks over people" from a coordinated friend group is within limits. Does the
    dogpile scan catch same-prompt-different-days? Where's the weekly same-prompt cap?
14. The self-harm tripwire triggers on *reactions* (mutes, pause, delete). Name a
    harmed user whose behavior pattern it misses. What proactive signal exists?
15. The fixability rule bans attribute prompts, but severity-3 "thinks they're
    smarter than everyone" is an attribute wearing a behavior's clothes. Audit the
    example prompts in §4.1 against the rule's own bright line. Does the rule need a
    test, and what is it?
16. 13–17 expansion is deferred, but nothing stops a 16-year-old lying about DOB at a
    college campus launch. What's the plan's actual minor-exposure surface, and does
    §11's App Store story survive it?
17. The founder-as-first-moderator claim meets the <24h SLA claim: compute the review
    queue size at wave 1 (5 campuses) using any reasonable report rate. When does
    this break, and is the hiring trigger in the plan?

**Legal & platform**
18. TCPA: the "picked non-user" invite hook renders a non-user's name in a ballot.
    Is *displaying* a contact's name to their friend, sourced from an uploaded
    address book, compliant in the strictest state (hint: check contact-upload
    consent precedents — Six4Three-era Facebook, LinkedIn Add-Connections)?
19. App Store 5.1.1 (data minimization) vs. mandatory contacts sync framing in
    onboarding: is contacts permission actually *required* to proceed in this flow?
    If yes, that's a rejection vector; find where the plan is ambiguous.
20. The FTC consent-decree pattern-match: list every mechanic in §12 a regulator
    could call a dark pattern (weekly billing on curiosity spikes? paywall after
    second hint tap?) and rank by resemblance to the NGL complaint's counts.
21. GDPR: votes are personal data of *two* people (voter and target). Whose deletion
    request wins on `votes` rows, and does the §11 pipeline handle the target-side
    cascade the schema doesn't obviously support?

**Architecture & operations**
22. The daily drop fans out per-timezone at 8pm local. Model the worker burst for
    500k users across 4 US timezones; does one Railway worker service with BullMQ
    survive the 20:00 ET spike, and what's the push-provider rate ceiling?
23. Moderation is called synchronously with a 500ms budget and fail-closed. What
    user-visible flows stall when Modal cold-starts at 20 rps? Is fail-closed on
    *display names during onboarding* actually acceptable (it blocks signup)?
24. `votes.deliver_after` + the drop batching means the hot query is a range scan on
    undelivered votes per recipient. Find the missing index / partitioning decision
    the DDL doesn't state.
25. The events table is "the durable copy" and also feeds Modal nightly jobs —
    estimate rows/day at wave 2 and check whether monthly partitions + Railway
    Postgres disk pricing were actually reconciled in §15.
26. EAS Update channels per campus cohort: what happens when a schema-affecting
    change ships OTA to half a campus mid-session? Where's the API versioning /
    minimum-client-version gate in §8? (It isn't there. Design it.)
27. One active device per account (§9) vs. teens who share phones and switch devices
    constantly: estimate the support/lockout load and check the OTP re-verify cost
    against §15's Twilio line.

**Economics & strategy**
28. Recompute §12's targets from the bottom up: at wave-2 scale (~50k users), does
    3% × $20 ARPPU fund the §15 wave costs *plus* ambassador spend *plus* two
    salaries? Where's the actual burn table this plan doesn't contain?
29. The moat is conceded to be thin (§17). Steelman the fast-follower: a clone
    launches at your wave-1 campuses with free hints (no k-floor scruples). Which
    of this plan's safety laws are competitive disadvantages, and what's the
    counter-positioning that doesn't abandon them?
30. College-first is the plan's riskiest call by its own admission. Argue the other
    side seriously: quantify what high-school-first wins (graph density, status
    intensity, tbh/Gas precedent) and what it costs, and check whether the plan's
    stated reasons (legal surface, ratings) actually bind at severity ≤ 2 decks.
31. The name "said" and every alternate in §0: trademark scan, App Store search
    collision, TikTok hashtag availability. Naming is deferred in the plan — make
    it un-deferrable by finding the conflict now.

**Meta**
32. Find the mechanic in this plan that exists because Gas had it, not because this
    product needs it. (There is at least one.) Argue for cutting it.
33. Find the law in §2 that the plan itself violates somewhere downstream. (Check L5
    against §14's build order and L2's ratios against §4.1's catalog counts.)
34. The plan claims the delivery layer makes a "life-ruining week" impossible (§2,
    death mechanism 4). That is a falsifiable absolute. Falsify it or downgrade the
    claim to what the caps actually guarantee.

---

*Plan ends. Nothing above is implemented; the build begins at §14 M0 only on the
owner's go.*

