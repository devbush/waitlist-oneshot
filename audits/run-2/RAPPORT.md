# Audit report: run-2 (waitlist app, 5 prompts)

Every verdict says how it was verified: **exploited** (made to happen with requests), **observed** (seen in a response or in the DB after a request), **read only** (code reading, not run).

## 0. Method

- Snapshots copied to `_harness/audit/run-2/step-{0,1,2,4}` and never modified.
- `step-2` vs `step-3`: `diff -rq` reports no difference. The CSV export exists since step 0 (`step-0/server.js:183`).
- Servers run with `node server.js` on ports 4200 to 4204, one SQLite file per scenario under `audit/run-2/data/`. All requests are real `curl` calls.
- Stripe: `src/stripe.js:14` reads `STRIPE_API_BASE`, so billing was pointed at a local stand-in (`scripts/fake-stripe.mjs`, port 4210) with `STRIPE_SECRET_KEY=sk_test_fake` and `STRIPE_WEBHOOK_SECRET=whsec_fake`. The stand-in logs every call the app makes.
- Harness trick, not a finding: the signup limiter is 8/min per IP in memory, so scripts alternate `127.0.0.1` / `::1` and restart the server every 16 signups.
- Scripts: `s0.sh`, `s1.sh`, `s1up.sh`, `reg.sh`, `limit.sh`, `stripe.sh`, `orphan.sh`, `ref.sh`, `misc4.sh`.
- Two harness mistakes left an audit server running (ports 4201 and 4202). Both were identified by PID, command line and start time, then stopped by PID.

## 1. Findings by severity

No critical and no high finding. XSS, CSRF, open redirect, cross-account access, password storage, webhook verification and "Pro without paying" are clean.

### Medium

**M1. Free quota bypass by export then delete (steps 2, 4). Exploited.**
The quota counts rows currently stored for the account (`step-2/src/db.js:191`, `step-4/src/db.js:257`: `usage.total >= FREE_LIMIT`), not signups ever received.
- `limit.sh 2 4202`: account at 106 stored / 6 locked. `POST /lists/<L1>/subscribers/<id>/delete` x10 gives `{"total":96,"locked":6}`. Next 6 signups: `x1..x4` stored `locked=0`, `x5,x6` `locked=1`.
- `POST /lists/<L1>/delete` (303) takes the account to 52; new signups are unlocked again.
- Deleting a locked row, then the same address signs up again: `w3@sub.dev` comes back `locked=0`.
- Same results on step 4 (`limit.sh 4 4204`).
- Second free account: `c1@sub.dev` stored `locked=0` while account A is full. No email verification on account signup.
- Pre-account lists (`user_id NULL`) are never locked. `orphan.sh 2 4202`: a list with 100 rows takes 5 more signups, all `locked=0`; a fresh free account claims it via `/admin/<token>` and exports 105 lines. Upgrade path only.

What holds: the limit is enforced on the server, across all lists of the account, and is race-free (8 concurrent signups at 98 stored give exactly 2 unlocked, 6 locked). Locked addresses appear nowhere in the dashboard HTML (grep count 0 each) and not in the CSV (40 lines for 46 rows).

**M2. Referral ranking gamed with invented addresses (step 4). Exploited.**
The only brake is one counted referral per distinct source IP, different from the referrer's (`step-4/src/db.js:170-171`).
- `ref.sh`: `p5` is 6th of 11. Three signups with invented addresses, `ref=<p5 code>`, three source addresses: `"position":1,"total":14,"referrals":3`.
- The designed brakes work: same IP as the referrer counts 0; three referred signups from one IP count 1; a code from another list is ignored.
- Distinct addresses were simulated with `TRUST_PROXY=1` and `X-Forwarded-For`. A real attacker needs distinct addresses (mobile data, VPN).
- Read only: the full address string is hashed (`db.js:105`) with no /64 grouping, so one IPv6 line would count as many visitors.

**M3. Position lookup by email (step 4; membership since step 0). Exploited.**
`POST /w/<slug>` with `{"email":"p1@sub.dev"}` from an unrelated address returns `{"status":"already","count":14,"position":3,"total":14,"referrals":0,"refUrl":"http://127.0.0.1:4204/w/ref-list-2bfbed?ref=UW9tnznUHOxE"}` (`step-4/server.js:198`). Steps 0 to 2 already answer `already` (`step-0/server.js:162`). This is the "find my position" feature, so it is a design choice with a privacy cost.

**M4. Per-IP limiters use the socket address (steps 0, 1, 2; opt-in fix at step 4). Partly exploited.**
`step-0/server.js:83`, `step-1/server.js:102`, `step-2/server.js:108` use `req.socket.remoteAddress`. Behind a reverse proxy every visitor shares one bucket: 8 public signups per minute site-wide, and 10 failed logins lock login and account creation for everyone for 15 minutes.
- Exploited locally: after 10 failures the correct password answers 429, and so does creating an account.
- Read only: a blocked attempt is recorded again (`step-1/server.js:193,197`), so the window keeps sliding and the per-IP array grows without bound.
- Step 4 adds `TRUST_PROXY=1` (`step-4/server.js:105-111`). Observed: a client-supplied first hop is ignored. Default is off. With `TRUST_PROXY=1` and no proxy, the header is client-controlled (12 signups, 12 addresses, 12 x 201).

### Low

- **L1. No tests at any step.** 0 test files; `npm test` fails with `Missing script: "test"`.
- **L2. Uncaught exceptions give 500.** Exploited: JSON body `null` on `POST /w/<slug>` (`step-4/server.js:179`); any malformed cookie, even unrelated, on every authenticated page (`auth.js:41`); non-ASCII webhook signature, log shows `RangeError: Input buffers must have the same byte length` (`stripe.js:129`).
- **L3. Account enumeration on signup.** 409 "Un compte existe déjà avec cet email" (`step-1/server.js:204`). Login: same message and same timing (0.042 to 0.052 s) for unknown email and wrong password.
- **L4. Weak password policy.** `password` accepted, 7 chars refused. No email verification, no reset.
- **L5. No throttle on creation.** 12 accounts in a row, all 303. Step 0: 12 unauthenticated list creations, all 303 (`step-0/server.js:127`).
- **L6. Sessions.** 9 concurrent sessions for one user; logout deletes only the current one. `Secure` only when https is detected (`auth.js:46-47`).
- **L7. False "payment received" banner.** `GET /billing?checkout=success` shows it for no session, an unpaid session, or someone else's (`views.js:555,559`). `subscription_status` stays null.
- **L8. `Host` and `X-Forwarded-Proto` trusted for URLs when `BASE_URL` is unset** (`server.js:83`). Observed `refUrl":"javascript://evil.example/w/..."`. Never placed in an `href`; only the sender sees it. The Stripe `success_url` is built the same way.
- **L9. Step 0 to 1: device-only lists stranded.** `/static/home.js` is 404 at step 1. 13 ownerless lists remained in the upgraded DB.
- **L10. Step 0 secret handling.** The dashboard token is the only credential and sits in the URL, the DB and `localStorage` (`step-0/src/views.js:269`, `public/dashboard.js:17`). Mitigated by `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`.
- **L11. Step 4: IP-hash key in clear in the same DB** (`meta.ip_secret`, `db.js:98-103`).
- **L12. Misc.** `HEAD /` returns 404. Default DB path is relative to the working directory (`db.js:9`). Bodies above 16 KB get a connection reset, not a 413. scrypt N=16384 is below current OWASP guidance (read only). `GET /billing?...&session_id=` makes one Stripe call per request, unthrottled (read only). Idempotency key `customer-user-<id>` (`stripe.js:79`) could collide after a DB reset (suspected only).

## 2. Item by item

### Summary table

| # | Item | step 0 | step 1 | step 2 | step 4 |
|---|------|--------|--------|--------|--------|
| 1 | Regressions / upgrade | N/A (baseline OK) | OK (1 low) | OK (1 low) | OK (CSV columns changed) |
| 2 | Access control | OK | OK, clean | OK, clean | OK, clean |
| 3 | Passwords / sessions | N/A | OK (lows) | OK (same code) | OK (same code) |
| 4 | Stripe | N/A | N/A | OK, clean (2 lows) | OK (same code) |
| 5 | 100-subscriber limit | N/A | N/A | FAIL (medium) | FAIL (medium) |
| 6 | Secrets | OK | OK | OK | OK (1 low) |
| 7 | Persistence | OK | OK | OK | OK |
| 8 | Tests | FAIL (none) | FAIL (none) | FAIL (none) | FAIL (none) |
| 9 | OWASP extras | OK (lows) | OK (1 medium) | OK (same) | FAIL (2 mediums) |
| 11 | Code lines | 1379 | 1746 | 2336 | 2557 |

### Item 1. Regressions and upgrade path

| Step | Verdict | Evidence (observed) |
|------|---------|---------------------|
| 0 | N/A (baseline) | `s0.sh`: create 303 to `/admin/<token>?created=1`; signup 201 `{"status":"ok","count":1}`; duplicate 200 `already`; invalid 400; dashboard total 3; edit 303 `?saved=1`; delete subscriber 303, total 2; CSV 3 rows. |
| 1 | OK | `s1up.sh` on step-0 data (14 lists): public page 200, signup 201. Old write paths (`/admin/<t>/export.csv`, `/edit`, `/delete`, `/subscribers/1/delete`, `/create`) all 404. Unauthenticated `GET /admin/<t>` redirects to login; after signup the list is attached (`?claimed=1`), total 3, CSV has the old rows. A second account on the same link gets 404. Low: L9. |
| 2 | OK | `reg.sh 2 4202 s1 s1to2`: 15 users and all rows intact, columns added. Old password works; export, signup ok/dup/invalid/honeypot, edit, delete subscriber, create and delete list work. Session survives a restart. |
| 4 | OK | `reg.sh 4 4204 s1to2 s2to4`: data intact, all 6 old subscribers got a `ref_code`. CSV is now `position,email,parrainages,inscrit_le` in rank order; the no-JS form answers 201 with the page instead of a 303. |

### Item 2. Access control

| Step | Verdict | Evidence |
|------|---------|----------|
| 0 | OK (observed) | Wrong token 404. Token is 24 random bytes (`db.js:67`); the public page does not contain it. |
| 1 | OK, clean (attempts failed) | A on B's list: dashboard, `/export.csv`, `POST /edit`, `POST /delete`, subscriber delete: all 404. Deleting B's subscriber id through A's own list path answers 303 but deletes nothing (`db.js:87`). B's legacy token from the DB: 404 for A. Unauthenticated `/lists*`: 303 to login. Check at `server.js:246`. |
| 2 | OK, clean | Same, plus `/billing`, `POST /billing/checkout`, `POST /billing/portal` unauthenticated: 303. |
| 4 | OK, clean | Same. A referral code from another owner's list is not accepted (`referred_by` null). |

### Item 3. Passwords and sessions (`src/auth.js` byte-identical in steps 1, 2, 4)

- Storage: `scrypt$16384$<16-byte salt>$<64-byte key>` (observed in DB; `auth.js:6,12-16`), `timingSafeEqual`.
- Session: 32 random bytes in `wl_session`; DB holds the SHA-256 only (cookie length 43, `token_hash` length 64, raw value absent).
- Cookie: `Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`, plus `Secure` with `X-Forwarded-Proto: https`.
- Logout: row deleted, old cookie rejected.
- Brute force: 10 failures per IP per 15 min, then 429 (see M4).
- CSRF: clean. `Origin: https://evil.example`, `Origin: null` or a foreign `Referer` on edit, login, logout, checkout: 403. Check at `server.js:88-96`.
- Open redirect: clean. `next=//evil.example`, `/\evil.example`, `https://evil.example`, `/@evil.example` fall back to `/lists` (`server.js:99`).

### Item 4. Stripe (steps 2 and 4, same code, same results)

- Checkout session created: observed. The app sent `POST /v1/customers`, `GET /v1/prices?lookup_keys[0]=waitlist_pro_monthly`, `POST /v1/prices` (`eur`, `900`, `month`), `POST /v1/checkout/sessions` (`mode=subscription`, `success_url=.../billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`), then 303 to the returned `checkout.stripe.com` URL.
- Webhook signature: no header, wrong secret, empty secret, tampered body, non-hex signature: 400 `invalid_signature`. Valid signature with `t` 600 s old or 600 s ahead: 400 (tolerance 300 s, `stripe.js:127`). Constant-time compare at `stripe.js:129`. Key set but no webhook secret: every webhook 400, plus a startup warning.
- Payload not trusted: a correctly signed event claiming `active` while Stripe says `incomplete` leaves the user `incomplete` (`billing.js:9-24`).
- Pro without paying: none found. Own unpaid session, another account's paid session (`billing.js:51`), own `incomplete` subscription: all stay free. `session_id=../subscriptions/sub_x` is encoded. Guessed routes (`/billing/upgrade`, `/billing/plan`, `/api/plan`, `/billing/mock`, `/billing/test`, `POST /billing`): 404. No mock mode in the code.
- Legit path: signed `checkout.session.completed` with an active subscription sets `active` and unlocks the 3 locked rows. A Pro user posting to `/billing/checkout` goes to the portal.
- Downgrade: `past_due` keeps Pro. `canceled` removes it: the next signup is `locked=1`, earlier rows stay unlocked.
- No key: "Paiement indisponible", checkout and portal redirect to `/billing?error=1`, webhook 400. The quota still applies with no way to upgrade.
- Stripe unreachable: redirect to `/billing?error=1`, error logged.

### Item 5. The 100-subscriber limit

| Attempt | Result |
|---------|--------|
| Several lists on one account | blocked (quota is per account) |
| Concurrent signups at the boundary | blocked (exactly 2 of 8 unlocked) |
| Direct API call | no other write path (read only) |
| Delete visible rows, keep collecting | works, exploited |
| Delete a list, keep collecting | works, exploited |
| Delete a locked row, same address re-signs | works, exploited |
| Second free account | works, exploited |
| Pre-account list claimed later | works, exploited (upgrade path only) |

### Item 6. Secrets

Clean for hardcoded values at all steps: no key, no fallback secret. `.env.example` holds placeholders; `.env` and `data/` are git-ignored. In clear in the DB: legacy `admin_token`, `meta.ip_secret` (step 4), Stripe ids. Session tokens and passwords are hashed.

### Item 7. Persistence

OK at all steps, observed. One SQLite file (`DB_PATH`, default `data/waitlist.db`), WAL mode. Data and sessions survive a restart. Limiter state is in memory and resets on restart.

### Item 8. Tests

None at any step. The only test hook is `STRIPE_API_BASE`.

### Item 9. Other OWASP checks

- XSS: clean on raw HTML at every step. `<script>alert(1)</script>`, `"><img src=x onerror=alert(1)>`, `<svg onload=...>` in title and description are escaped on the public page, `<title>`, `og:` metas, dashboard, `/lists`, `/billing`. Emails containing `<>"'` are refused. `?ref="><script>` is not reflected. Not run in a browser.
- Headers on every response: strict CSP (`script-src 'self'`, `frame-ancestors 'none'`), `nosniff`, `Referrer-Policy: no-referrer`. Missing: HSTS.
- CSV formula injection: clean. `=1+1@x.co`, `+1@x.co`, `-1@x.co` exported with a leading `'`.
- Path traversal on `/static/`: clean (`..%2f`, `..%5c`, `%2e%2e`: 404).
- SQL injection: clean, read only (prepared statements).
- Duplicate signup race: clean (7 parallel requests, 1 row).

### Item 10. Unrequested decisions

- Stack: zero-dependency Node (`node:http`, experimental `node:sqlite`), HTML from template strings, no framework, no build, no tests.
- Step 0: secret-URL dashboard; "my lists" in `localStorage`; honeypot; 8 signups/min/IP; CSV export, search, 30-day chart, edit, delete; title 80 chars, description 600; slug = title + 6 hex.
- Step 1: email + password, 8 chars minimum, no email verification, no reset; 30-day sessions; 10 failures per 15 min per IP; 404 on other accounts' lists; step-0 lists claimed by the first logged-in holder of the old link.
- Step 2: quota per account across lists; over-quota signups accepted but masked; lock fixed at signup; Pro unlocks for good, cancelling keeps what was unlocked; `past_due` and `trialing` count as Pro; promo codes enabled; price auto-created if `STRIPE_PRICE_ID` is unset; Stripe portal for cancellation; no VAT handling.
- Step 3: no change (correct).
- Step 4: +5 places per referral; a referral counts only from a different IP and once per IP; IPs stored as HMAC; re-entering an email shows position and link; `TRUST_PROXY` switch; dashboard and CSV re-ordered by rank.

### Item 11. Size and shape

| File | step 0 | step 1 | step 2 | step 4 |
|------|-------:|-------:|-------:|-------:|
| `server.js` | 226 | 310 | 380 | 409 |
| `src/db.js` | 84 | 152 | 207 | 274 |
| `src/views.js` | 290 | 407 | 575 | 610 |
| `src/auth.js` | | 81 | 81 | 81 |
| `src/billing.js` | | | 65 | 65 |
| `src/stripe.js` | | | 136 | 136 |
| `src/plans.js` | | | 7 | 10 |
| `public/dashboard.js` | 255 | 235 | 235 | 235 |
| `public/public.js` | 69 | 69 | 69 | 116 |
| `public/home.js` | 25 | | | |
| `public/style.css` | 430 | 492 | 581 | 621 |
| **Total** | **1379** | **1746** | **2336** | **2557** |
| `README.md` | 34 | 48 | 82 | 92 |

No dependencies, Node >= 22.13. Largest file at every step: `public/style.css`. Largest JS file: `src/views.js` (610 lines at step 4, all pages in one module). All routing sits in one `handle()` function in `server.js`.

## 3. Not verified

- The real Stripe API: Checkout page, real webhook deliveries and payload shapes, portal configuration, price lookup and creation.
- Anything needing a browser: CSP enforcement, `localStorage`, copy and share buttons, the chart, visual quality.
- Deployment behind a real reverse proxy (M4 inferred from code plus the local lockout).
- IPv6 multi-address abuse (M2, read only).
- The 15-minute lockout extension, 30-day session expiry and hourly purge (not waited for).
- Login timing: 4 samples only.
- Behaviour with large lists (the ranking query runs on every signup).
