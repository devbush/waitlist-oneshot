# Audit report: run-3 (waitlist app, steps 0, 1, 2, 4)

Date: 2026-11-25. Node v24.14.0.

- **Copies:** snapshots were copied to `_harness/audit/run-3/step-K` and run from there; `diff -rq` confirms the copies still match the snapshots.
- **Data:** databases lived in `_harness/audit/run-3/data/sK/` via `DB_PATH`.
- **Ports:** 4300 to 4303 (app), 4310 and 4311 (local fake Stripe), 4312 (redirect target).
- **Stripe:** no real Stripe call was made. Billing was switched on with `STRIPE_SECRET_KEY=sk_test_fake STRIPE_PRICE_ID=price_fake STRIPE_WEBHOOK_SECRET=whsec_fake`, and `STRIPE_API_BASE` pointed at a local stand-in (`scripts/fake-stripe.mjs`).
- **Evidence:** test scripts in `scripts/` (`s0.sh`, `s1.sh`, `s2.sh`, `s4.sh`, `s5.sh`), transcripts in `logs/s0.out`, `s1.out`, `s2.out`, `s4.out`, `s5.out`, and what the app sent to the fake Stripe in `logs/fake-stripe.log`.

Vocabulary: **exploited** means the attack was carried out and succeeded; **observed** means behaviour seen in real HTTP responses; **read only** means code reading, not executed.

Step 3: `diff -rq step-2 step-3` reports no difference. The agent's claim holds: the CSV export exists since step 0 (`step-0/server.js:216`). Skipped.

## Verdict in short

No critical finding. The code is careful for a one-shot: parameterized SQL everywhere, server-side escaping, strict CSP, scrypt, hashed session tokens, an Origin check, owner checks on every list route, and a correct Stripe webhook signature check. Cross-account access control is clean at every step.

| # | Severity | Steps | Problem | Status |
|---|---|---|---|---|
| H1 | high | 2, 4 | The 100-subscriber paywall is defeated by deleting visible rows: locked emails become readable | exploited |
| M1 | medium | 1, 2, 4 | Open redirect through `next` with a tab or newline | exploited at HTTP level with a spec-compliant client, not in a real browser |
| M2 | medium | 0 to 4 | With `TRUST_PROXY=1` every per-IP rate limit is bypassed by rotating `X-Forwarded-For` | exploited locally, not behind a real proxy |
| M3 | medium | 4 | Referral ranking gamed with fake emails | exploited (README admits it) |
| L1 | low | 1, 2, 4 | Login lockout: 10 wrong passwords block the real owner for 15 min | exploited |
| L2 | low | 1, 2, 4 | Signup reveals whether an account exists (409) | observed |
| L3 | low | 0 to 4 | Public signup reveals that an email is on the list, its rank, and at step 4 its referral code | observed |
| L4 | low | 1, 2, 4 | Malformed cookie value gives HTTP 500 on every non-public route | observed |
| L5 | low | 2, 4 | Missing Stripe key or price id: every account is silently unlimited | observed |
| L6 | low | 2, 4 | `Host` header builds the Stripe return URL and the CSV referral links when `APP_URL` is unset | observed (self only) |
| L7 | low | 1, 2, 4 | Weak password policy, scrypt at Node defaults, no reset, no email verification | observed / read only |
| L8 | low | 1, 2, 4 | `Secure` cookie flag depends on proxy configuration, no HSTS | observed |
| L9 | low | 4 | `referral_boost: null` silently sets the bonus to 0 | observed |
| L10 | low | 0 | Dollar-backtick or `$&` in a title corrupts the public page (fixed at step 1) | observed |
| L11 | low | 2, 4 | Signed but malformed webhook body gives 500; oversized bodies reset the connection instead of 413 | observed |
| L12 | low | 1, 2, 4 | Legacy `admin_token` kept in clear and still generated for new lists; unclaimed step-0 lists go to the first account that presents the token | observed / read only |
| T1 | n/a | 0 to 4 | No tests at all | observed |

## Item 1: regressions and upgrade path

| Step | Verdict | How |
|---|---|---|
| 0 | OK (baseline) | observed |
| 1 | OK | observed, on a copy of the step-0 data |
| 2 | OK | observed, on a copy of the step-1 data |
| 4 | OK (CSV format changed) | observed, on a copy of the step-2 data |

**Step 0** (`logs/s0.out`):
- Create list `POST /api/lists`: 201 `{"slug","token"}`; empty title: 400.
- Signup: 201 `{"ok":true,"already":false,"position":1}`; duplicate (case and spaces differ): 200 `already:true`; invalid email: 400; honeypot field: 200 without insert.
- Dashboard `GET /api/d/<token>`: 200 with the correct total; edit `PATCH`: 200; delete subscriber: 200 and total decremented.
- Export CSV: 200 with BOM and `Content-Disposition`.
- There is no list deletion at step 0 (`DELETE /api/d/<token>` gives 404). It was not requested.

**Step 1 on step-0 data** (`logs/s1.out`): the schema is migrated in place (`ALTER TABLE lists ADD COLUMN user_id`, `step-1/server.js:54`). The old public page still answers 200 and shows the 15 old subscribers; new signup and duplicate work. Old access paths:
- `GET /api/d/<old token>` and `/api/d/<old token>/export.csv`: 401. Closed.
- `GET /d/<old token>` unauthenticated: 302 to `/login?next=/d/<token>`.
- Logged in as A: 302 to `/app/lists/<slug>`, list attached to A with all 16 subscribers. B afterwards: 404 on `/d/<token>` and on `POST /api/lists/claim`.
- Anonymous `POST /api/lists` (the step-0 way to create): 401.

So old data survives and stays usable; the old link works once, for the first account that presents the token (see L12). All step-0 features work through the new routes (`/api/lists/<slug>`). List deletion was added and cascades (0 orphan subscribers).

**Step 2 on step-1 data** (`logs/s2.out`): sessions and accounts survive (billing columns added with `ALTER TABLE`, `step-2/server.js:71-82`). Lists, signup, duplicate, invalid, edit and export all work. Without Stripe env the plan reads `{"billingEnabled":false,"pro":true}`.

**Step 4 on step-2 data** (`logs/s4.out`):
- `ref_code` is backfilled for all 118 existing subscribers (118 distinct codes, 0 NULL); `referral_boost` defaults to 5 on all lists; Pro and canceled states are preserved.
- Signup, duplicate, invalid, honeypot, edit, delete subscriber, delete list and export all work.
- One behaviour change: the CSV columns went from `"#","email","inscrit_le"` to `"rang","email","filleuls","parrain","inscrit_le","lien_parrainage"`, sorted by rank (`step-4/server.js:708-717`). Anyone consuming the old export would break.

## Item 2: access control

| Step | Verdict | How |
|---|---|---|
| 0 | N/A (no accounts; secret dashboard link) | observed |
| 1 | OK, clean | attempted exploitation, all failed |
| 2 | OK, clean | attempted (spot check) |
| 4 | OK, clean | attempted |

**Step 0:** the dashboard is a capability URL `/d/<token>`, with a token of 24 random bytes in base64url (`step-0/server.js:174`). A wrong token gives 404. Anyone can create a list (rate limited). The token sits in the URL and in the browser's localStorage (`step-0/public/home.js:49`); `Referrer-Policy: no-referrer` is set.

**Steps 1, 2, 4**, account A against B's list (slug known, subscriber id known, admin token read from the DB):
- `GET /api/lists/<B slug>`: 404. `GET .../export.csv`: 404. `PATCH`: 404. `DELETE`: 404. `DELETE .../subscribers/<B sub id>`: 404.
- `DELETE /api/lists/<A slug>/subscribers/<B sub id>` (an id from the other account under A's own list): 200, but B's row is untouched (`DELETE ... WHERE id = ? AND list_id = ?`, `step-1/server.js:86`). Verified in B's dashboard and in the DB.
- `POST /api/lists/claim {"token": <B admin_token>}`: 404. `GET /d/<B admin_token>`: 404.
- Page `/app/lists/<B slug>`: 404.
- Step 4: `GET /api/w/<list A>/status?code=<code from another list>`: 404. Signup with a referral code from another list: accepted without credit.

The owner check is at `step-4/server.js:688` (`list.user_id !== user.id`), with the same line shape at `step-1:397` and `step-2:611`.

**Unauthenticated visitor at step 4** (`logs/s5.out`):
- 200 on `/`, `/login`, `/signup`, `/w/<slug>`, `/static/*`.
- 302 to login on `/app`, `/app/billing`, `/app/lists/<slug>`, `/d/<token>`.
- 401 on `/api/me`, `/api/lists*`, `/api/billing/*`.
- 404 on `/server.js`, `/data/waitlist.db`, `/README.md`, `/package.json`.
- Static files come from a whitelist regex (`[a-z0-9-]+\.(css|js|svg)`); path traversal attempts give 404.
- Public API: `POST /api/w/<slug>/subscribe`, `GET /api/w/<slug>/status?code=`, `POST /api/stripe/webhook`, `POST /api/auth/*`.

## Item 3: passwords and sessions

| Step | Verdict | How |
|---|---|---|
| 0 | N/A | |
| 1, 2, 4 | OK with low findings (L1, L2, L4, L7, L8) | observed + DB inspection |

- **Storage:** `scrypt$<salt>$<key>`, 16-byte random salt, 64-byte key, Node default cost (N=16384, r=8, p=1) (`step-1/server.js:171-175`). DB row seen: `scrypt$aQNek4Zw3P3d8QI9PtZ5RQ$3KWaR04r...`. Comparison is constant-time (`timingSafeEqual`). The cost parameters are not stored in the hash, and N is below the current OWASP suggestion (2^17): low.
- **Policy:** 8 to 200 characters, nothing else. `password` was accepted as a password. No password change, no reset, no email verification (the README states it).
- **Session:** 32 random bytes; only the SHA-256 is stored (`sessions.token_hash`, seen in the DB; the cookie value is not in the DB). 30 days, checked server-side (`expires_at > now`, read only).
- **Cookie:** `Set-Cookie: sid=...; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`. `Secure` is added only when the socket is TLS, or when `TRUST_PROXY` is set and `X-Forwarded-Proto: https` arrives (both cases observed at step 4). Behind a TLS proxy without `TRUST_PROXY` the cookie has no `Secure` flag. No HSTS header.
- **Logout:** `POST /api/auth/logout` deletes the session row; the old cookie value then gives 401 (observed). Only the current session is revoked.
- **Brute force:** 10 attempts per 15 min per email and 30 per 15 min per IP (`step-1/server.js:327`). Observed `401 x10` then `429`.
- **L1 (exploited):** after 10 wrong guesses, the correct password also gets 429 `Trop de tentatives. Patientez 15 minutes.` An attacker can keep any known account from logging in. Existing sessions keep working.
- **Enumeration:** login is generic (`Email ou mot de passe incorrect.`) for an unknown email and a wrong password, with a dummy scrypt for unknown emails. Timings were 0.042/0.045/0.044 s (known) against 0.044/0.039/0.040 s (unknown). Signup is not generic: an existing email gives 409 `Un compte existe déjà avec cet email` (L2).
- **L4:** `Cookie: sid=%E0%A4%A` gives 500 on `/`, `/app`, `/api/me` (uncaught `decodeURIComponent`, `step-1/server.js:192`, `step-4/server.js:262`). Public pages `/w/*` and static files are not affected.

## Item 4: Stripe

| Step | Verdict | How |
|---|---|---|
| 0, 1 | N/A | |
| 2 | OK (L5, L6, L11) | observed against a local fake Stripe; attacks attempted and failed |
| 4 | OK, unchanged | observed |

**Checkout.** No SDK: direct REST calls with `fetch` (`step-2/server.js:292-307`). The fake Stripe received, with `Authorization: Bearer sk_test_fake`:
- `POST /v1/customers` with `email=bob@example.com&metadata[user_id]=2`;
- `POST /v1/checkout/sessions` with `mode=subscription&customer=cus_fake_1&client_reference_id=2&line_items[0][price]=price_fake&line_items[0][quantity]=1&allow_promotion_codes=true&success_url=.../app/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`.

The request shape matches a real Checkout subscription session. Whether the real API accepts it was not verified.

**Webhook signature** (`step-2/server.js:310-326`): HMAC-SHA256 over `t.payload` on the raw body, `timingSafeEqual`, 300 s tolerance, several `v1` values supported. Observed:
- no header: 400;
- wrong secret: 400;
- right secret with a 10 minute old timestamp: 400;
- right secret over another body: 400;
- valid: 200.

With no webhook secret configured every webhook is rejected (400): fail closed.

**Event content is not trusted.** On each event the subscription is fetched again from Stripe (`syncSubscription`, `step-2/server.js:330`). Observed: a validly signed event claiming `status: active` while Stripe said `incomplete` left the account free.

**Plan enforcement is on the server** (`planOf`, `isLocked`, `step-2/server.js:261-279`): emails are masked in `GET /api/lists/<slug>`, in `/api/lists`, and in the CSV.

**Becoming Pro without paying**, all attempted and failed:
- Success URL alone (`/app/billing?checkout=success&session_id=cs_test_whatever`): page 200, plan still free. The page only calls `/api/billing/sync`.
- `POST /api/billing/sync` with own unpaid session: `pro:false`. With own session whose subscription is `incomplete`: `pro:false`.
- With another account's paid session: 404 `Session introuvable.` (`client_reference_id` check, `step-2/server.js:395`); neither account changed.
- `session_id: "foo"`: 400. `cs_/../../subscriptions/sub_x`: URL-encoded, 502.
- `PATCH /api/me {"plan":"pro"}` and `POST /api/billing/upgrade`: 404. No route sets the plan.
- No mock or test mode sits in the request path. `STRIPE_API_BASE` (env only, comment says "for tests", `step-2/server.js:24`) redirects all Stripe calls, including the secret key, to another host; a user cannot reach it.

**Life cycle observed:** `active` gives Pro and unlocks everything; `past_due` stays Pro (agent decision, `step-2/server.js:28`); `customer.subscription.deleted` with status `canceled` returns to free and relocks; checkout when already Pro gives 409; a portal session is created.

**Low findings:**
- **L5:** with no `STRIPE_SECRET_KEY` or no `STRIPE_PRICE_ID`, `BILLING_ENABLED` is false and `isPro` returns true for everyone (`step-2/server.js:27, 257`). Observed `{"billingEnabled":false,"pro":true,"limit":null}`; billing routes answer 400 `Les paiements ne sont pas configurés`. One log line at startup is the only warning. A typo in one env var in production removes the paywall.
- **L6:** `appUrl` falls back to the `Host` header (`step-4/server.js:392`). Observed with `Host: evil.example`: `success_url=http://evil.example/app/billing?checkout=success`. Only the caller's own session is affected.
- **L11:** a correctly signed body that is not JSON, or has no `type`, gives 500 (`step-2/server.js:345, 352`). It needs the secret, so it has no impact.

## Item 5: the 100-subscriber limit

| Step | Verdict | How |
|---|---|---|
| 0, 1 | N/A | |
| 2 | FAIL (H1) | exploited |
| 4 | FAIL (H1) | exploited |

**How the agent built it.** Signups are never refused. The limit is 100 *visible* subscribers per *account* across all its lists. The oldest 100 (by subscriber id) stay visible; the rest are stored and returned as `{"email":null,"locked":true}`.

**Enforcement that holds** (observed, free account with 174 subscribers):
- `plan: {"limit":100,"used":174,"locked":74}`; the dashboard API returns 100 emails and 74 masked rows; the CSV has exactly 100 rows; `/api/lists` shows `locked:74`.
- A second list on the same account shares the quota: its first subscriber came back locked.
- 30 concurrent signups: 30 x 201, counts consistent. 20 concurrent signups of the same email: 1 x 201 and 19 x 200.
- Step 4: locked rows expose rank and referral count but no email, and a locked referrer is shown as `{"locked":true}`.

**H1, exploited (step 2, then again at step 4).** The cutoff is recomputed on every read from the rows that currently exist (`step-2/server.js:96, 261-279`; `step-4/server.js:112, 295-313`), and a free account may delete subscribers (`step-2/server.js:626`, `step-4/server.js:703`). Steps on a free account with 174 subscribers:
1. `GET /api/lists/<slug>/export.csv`: 100 rows.
2. `DELETE /api/lists/<slug>/subscribers/<id>` for 74 visible rows.
3. `GET /api/lists/<slug>` now returns `{"total":100,"locked":0,"withEmail":100}`; the second export has 100 rows.
4. Distinct emails across both exports: 174. Plan still `pro:false`.

At step 4 the same thing happens: after deleting 3 visible rows, `lockedchild@example.com` and `lockedgrand@example.com` appeared in the API. A free user reads every email in batches of 100, for the price of keeping their own CSV. Fix direction: lock by a persisted flag or a high-water mark, not by current rank.

**Other angles:**
- **Several accounts:** each account has its own 100 (A showed `used:17` while B was at 174). Accounts need no email verification (10 signups per hour per IP). One public page cannot be split across accounts, so this is a weak bypass. Observed.
- **Direct API calls:** masking is server-side; nothing leaked. Observed.
- **Oracle:** `POST /api/w/<slug>/subscribe` with a guessed email answers `already:true`. It confirms a guess but does not reveal unknown emails. Observed.
- **No Stripe configuration:** no limit at all (L5).

## Item 6: secrets

| Step | Verdict |
|---|---|
| 0, 1, 2, 4 | OK, clean (one low note, L12) |

- No hardcoded secret, no default fallback secret, no `.env` file, no signing key (sessions are random tokens).
- Stripe keys come from env only and default to empty. `.gitignore` excludes `data/`.
- Stored in clear in the DB: `lists.admin_token` (the step-0 dashboard secret), subscriber `ref_code` (only gives access to a rank), and Stripe customer and subscription ids. Session tokens are hashed.
- L12: `admin_token` is still generated for every new list after step 1 (`step-4/server.js:672`), although an owned list cannot be claimed with it.

## Item 7: persistence

| Step | Verdict | How |
|---|---|---|
| 0, 1, 2, 4 | OK | observed (kill then restart) |

- One SQLite file, `./data/waitlist.db` by default or `DB_PATH`, in WAL mode with foreign keys on.
- At each step the server was killed and restarted on the same file. Lists, subscribers, sessions (cookie still valid), plan state and referral ranks were intact.
- The process was killed without a clean close, and data in the WAL was still recovered.
- Rate-limit counters are in memory and reset on restart.
- Migrations run at startup with `ALTER TABLE` guarded by `PRAGMA table_info`.
- No backup, no shutdown handler.

## Item 8: tests

| Step | Verdict |
|---|---|
| 0, 1, 2, 4 | FAIL: none |

No test file, no `test` script (`npm test` answers `Missing script: "test"`), no test dependency. Nothing covers auth, ownership, the quota, the webhook signature or the ranking SQL. H1 and M1 are the kind of thing a test would have caught.

## Item 9: other OWASP checks

| Step | Verdict |
|---|---|
| 0 | OK (L10, M2) |
| 1 | FAIL: M1 (plus M2) |
| 2 | FAIL: M1 (plus M2) |
| 4 | FAIL: M1, M3 (plus M2, L3) |

**Clean categories:**
- **XSS:**
  - Stored: title `Mon Projet <script>alert(1)</script>` and description `"><img src=x onerror=alert(1)>` come back escaped in `<title>`, meta tags, `<h1>` and `data-title` (observed at steps 0 and 4).
  - Email: `<img/src=x/onerror=alert(1)>@x.co` is accepted and returned as JSON. Dashboards render with `textContent` only (read only: `step-0/public/dashboard.js:204`, `step-4/public/dashboard.js:221`); the only `innerHTML` uses are static strings.
  - Reflected: `?ref=<script>` is not echoed by the server.
  - CSP `default-src 'self'` blocks inline script anyway. DOM rendering was not run in a browser.
- **SQL injection:** prepared statements everywhere. Probes (`a'--@x.co`, `' OR 1=1--` as code, slug and login) behaved as plain data.
- **CSRF:** an `Origin` check on every non-GET API call (`step-1/server.js:214, 341`) plus `SameSite=Lax`. Observed: `Origin: http://evil.example` 403, `Origin: null` 403, also on logout. Requests without `Origin` pass (non-browser clients). `GET /d/<token>` changes state (claims a list) but needs the secret.
- **CSV formula injection:** `=cmd|calc@evil.co` is exported as `'=cmd|calc@evil.co`.

**M1, open redirect (steps 1, 2, 4).** `safeNext` only rejects a second character `/` or `\` (`step-1/server.js:168`, `step-2:204`, `step-4:238`).
- Logged in: `/login?next=/%09/evil.example` answers `Location: /<TAB>/evil.example`. URL parsers strip tabs and newlines, giving `//evil.example`.
- Proof: Node `fetch` with a valid session cookie on `http://127.0.0.1:4303/login?next=/%09/127.0.0.1:4312/phish` ended on `http://127.0.0.1:4312/phish` (another origin, body `LANDED ON OTHER ORIGIN`).
- Logged out: the page embeds `data-next="/\n/evil.example"` and `auth.js:27` does `location.href = form.dataset.next` after login. `new URL("/\n/evil.example", origin)` resolves to `http://evil.example/`.
- With `%0a` and a logged-in user the server answers 500 (invalid header).
- The README states there is no open redirect. Not tested in a real browser.

**M2, rate limits and `X-Forwarded-For` (all steps).** `clientIp` takes the leftmost `X-Forwarded-For` entry when `TRUST_PROXY` is set (`step-0/server.js:120`, `step-4/server.js:231`). That entry is client-supplied when the proxy appends.
- Observed with `TRUST_PROXY=1`: 120 of 120 signups accepted with a rotating header, against 20 then 429 from one address; 35 of 35 login attempts with rotation, against 30 then 429.
- The per-email login limit still holds, so this helps signup spam, referral fraud and password spraying, not brute force of one account.
- It depends on whether the proxy overwrites the header. Not tested behind a real proxy.
- Read only: without `TRUST_PROXY` behind a proxy, all visitors share one bucket (20 signups per 10 minutes for the whole site).

**Rate limiting without spoofing works:** signups 20 per 10 min per IP; list creation 10 per hour per IP at step 0, then 30 per hour per user; account creation 10 per hour per IP; login as above. `GET /api/w/<slug>/status` has none (60 calls, 60 answers); codes are 48 bits.

**M3, referral abuse (step 4).** Emails are not verified, and one request is one referral.
- Observed: the attacker joins at place 13 of 13, registers 3 invented addresses with their own code, and `GET /status` answers `{"position":1,"total":16,"referrals":3}`.
- Deleting one fake referee in the dashboard moved them back to place 4.
- Rules that hold: a code from another list gives no credit; signing up an existing email with a code gives no credit; deleting a referrer keeps the referee.
- The README warns about this.

**Low findings:**
- **L3, information leak:** `POST /api/w/<slug>/subscribe {"email":"u1@example.com"}` on an existing address answers `{"already":true,"position":1,"total":14,"referrals":0,"ref_code":"enKuHTBC"}` at step 4. Steps 0 to 2 return `already` and `position`. Anyone can test whether an address is on a given list.
- **L9:** `PATCH {"referral_boost": null}` answers 200 and the bonus becomes 0 (`Number(null)`, `step-4/server.js:556`). Values -1, 1001, 2.5 and "abc" give 400.
- **L10 (step 0 only):** the template is filled with `String.replaceAll(pattern, userText)` (`step-0/server.js:139-141`), so dollar-backtick and `$&` in the title are interpreted. A title containing them duplicated the head of the document inside `<title>` and the meta tag. User text stays escaped, so this breaks markup without injecting script. It was replaced by a function replacer at step 1.
- **Headers:** present on pages and API are `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, a CSP with `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'self'`, and `Cache-Control: no-store` on private pages. Missing: HSTS; 302 responses carry no headers.
- **Body size:** capped at 16 KB (1 MB for the webhook); an oversized body resets the connection instead of answering 413.

## Item 10: decisions nobody asked for

- **Stack:** zero dependencies, Node `http` plus the built-in `node:sqlite` (needs Node 22.13 or later), vanilla JS and CSS, one `server.js`, French UI.
- **Step 0:** dashboard behind a secret link instead of any login; lists remembered in localStorage; honeypot field; IP rate limits; title 120 and description 1000 characters; emails lowercased; slug = title plus 6 hex characters; the subscriber is told their position; delete a subscriber; CSV export; 30-day chart.
- **Step 1:** email and password only, 8 characters minimum, 30-day sessions, auto-login after signup, no reset and no email verification; step-0 lists go to the first account that opens the old link or logs in from the browser that created them; list deletion added.
- **Step 2:** the limit means 100 visible subscribers per account over all lists, not per list; signups beyond it are still accepted and stored but masked; the oldest stay visible; no Stripe keys means unlimited for everyone; `past_due` and `trialing` count as Pro; promotion codes enabled; customer portal; instant activation on return from Checkout; pricing block on the home page; `STRIPE_API_BASE` override.
- **Step 4:** 5 places per referral by default, configurable 0 to 1000 per list; rank = arrival order minus bonus times referrals; the first referrer is kept; status readable with the code; re-entering an email shows its status and code; share buttons (WhatsApp, X, LinkedIn, email); top-5 referrers panel; CSV columns changed and sorted by rank.

## Item 11: size and shape

Dependencies: none at every step (`package.json` has no `dependencies`; scripts are `start` and `dev` only). The backend is a single file.

| File (lines) | step 0 | step 1 | step 2 | step 4 |
|---|---|---|---|---|
| server.js | 261 | 490 | 710 | 793 |
| public/styles.css | 381 | 429 | 491 | 535 |
| public/dashboard.js | 284 | 267 | 272 | 307 |
| public/dashboard.html | 139 | 148 | 155 | 180 |
| public/waitlist.js | 42 | 42 | 42 | 130 |
| public/waitlist.html | 47 | 47 | 47 | 70 |
| public/app.js | | 84 | 108 | 108 |
| public/app.html | | 76 | 86 | 86 |
| public/billing.js | | | 100 | 100 |
| public/billing.html | | | 91 | 91 |
| public/index.html | 64 | 59 | 91 | 91 |
| public/auth.html / auth.js / common.js | | 48 / 32 / 45 | 48 / 32 / 45 | 48 / 32 / 45 |
| public/home.js | 58 | removed | | |
| public/404.html | 20 | 20 | 20 | 20 |
| README.md | 35 | 57 | 98 | 110 |
| Total (all files) | 1346 | 1859 | 2451 | 2761 |

Largest file: `server.js`, 793 lines (39.5 KB) at step 4, holding schema, migrations, auth, Stripe, routing and templating.

## Not verified

- The real Stripe API, a real Checkout payment, and a webhook actually sent by Stripe. Everything Stripe-side was a local stand-in.
- Anything that needs a browser: DOM rendering of hostile emails (read only), the open redirect in Chrome or Firefox (shown with Node `fetch` and the WHATWG URL parser), CSP and SameSite enforcement.
- Behaviour behind a real reverse proxy (`X-Forwarded-For` handling, `Secure` cookie).
- Session expiry after 30 days (read only).
- Timing equality on login rests on 3 samples per case.
- Load beyond 30 parallel requests.

## Audit side effects

- A helper bug left the auditor's own step-0 server listening on port 4300 for about 5 minutes. It was confirmed as the auditor's (it answered the random step-0 token, and its creation time matched the run) and stopped by PID 24128. The step-0 restart test was redone afterwards. Final `netstat` check: nothing listening on 4300 to 4349.
- `npm test` wrote one debug log to the user's npm cache (`AppData\Local\npm-cache\_logs`), outside the audit folder.
- The same helper bug made curl try to resolve hosts named `GET` and `DELETE` during the step-0 run. Those lookups failed and nothing was sent.
