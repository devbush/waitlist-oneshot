# Audit report: run-1 (waitlist app, 5 prompts)

Date: 2026-11-25. Every snapshot was run from a copy in `_harness/audit/run-1/step-K`, on ports 4100-4129, with Node v24.14.0.
Snapshots were not modified. No real Stripe call was made: `STRIPE_API_BASE` was pointed at a local stand-in (`tools/fake-stripe.mjs`, port 4110).

Evidence files (all under `_harness/audit/run-1/`):

| File | Content |
|---|---|
| `tools/*.sh`, `tools/*.mjs` | The scenarios that were run (start server, curl, stop by PID) |
| `logs/s0.out` | step 0 full scenario |
| `logs/s1.out`, `logs/s2-general.out`, `logs/s4-general.out` | accounts, access control, sessions, CSRF (same script on steps 1, 2, 4) |
| `logs/up01.out`, `logs/upgrades.out` | upgrade paths 0->1, 1->2, 2->4, 0->1->2->4, 0->4 |
| `logs/s2-billing.out`, `logs/s4-billing.out` | Stripe checkout, webhook forgery, plan changes |
| `logs/s2-limit.out`, `logs/s4-limit.out` | 100-subscriber limit and bypasses |
| `logs/s4-ref.out`, `logs/s4-misc.out` | referral, XSS probes, Host header, open redirect, misc |

Line numbers refer to `server.js` of the named snapshot unless another file is given.

## 0. Step 3

`diff -rq step-2 step-3` prints nothing (exit 0): the two snapshots are byte-identical. The agent's claim that the CSV export already existed is true (the route exists since step 0, `step-0/server.js:416`). Step 3 skipped.

## Summary table

| # | Item | step 0 | step 1 | step 2 | step 4 |
|---|---|---|---|---|---|
| 1 | Regressions and upgrade path | OK (baseline) | FAIL: step-0 lists orphaned on upgrade | OK (1->2 clean) | OK (2->4 clean) |
| 2 | Access control | OK (secret-link model) | OK | OK | OK |
| 3 | Passwords and sessions | N/A | OK, low issues | OK, low issues | OK, low issues |
| 4 | Stripe | N/A | N/A | OK | OK |
| 5 | 100-subscriber limit | N/A | N/A | FAIL: bypassed | FAIL: bypassed |
| 6 | Secrets | OK (admin token in clear in DB, by design) | OK | OK | OK |
| 7 | Persistence | OK | OK | OK | OK |
| 8 | Tests | 2 pass | 6 pass | 11 pass | 16 pass |
| 9 | Other OWASP | OK, low issues | open redirect, XFF trust | same as step 1 | same + referral abuse |
| 10 | Unrequested decisions | see list | see list | see list | see list |
| 11 | Size (server.js / all files, lines) | 449 / 1910 | 671 / 2524 | 942 / 3272 | 1123 / 3773 |

## Findings by severity

No critical finding. Nothing allowed one account to read or change another account's data, and nothing allowed becoming Pro without a signed Stripe event.

### HIGH-1. The free-plan limit is bypassed by export, delete, export (steps 2 and 4). Exploited.

- Design: signups are never refused. On the free plan the owner only sees the first 100 subscribers of the account, by arrival order; the rest are stored but hidden (`step-4/server.js:538-546`, query `nthSubscriber` at `:147`). The window is computed on the rows that currently exist.
- Exploit (`logs/s2-limit.out`, `logs/s4-limit.out`, script `tools/limit.sh`): free account, 60 subscribers on L1 and 70 on L2.
  - `GET /api/lists/L2` -> `{"total":70,"hidden":30,"visible":40}`; the CSV has 40 rows.
  - `DELETE /api/lists/L2/subscribers/<id>` for the 40 visible ids -> 40 x 200.
  - `GET /api/lists/L2` -> `{"total":30,"hidden":0,"visible":30,"first":"u101","last":"u130"}`.
  - Result: `distinct L2 emails harvested on the free plan: 70 of 70`.
- Variant, deleting a whole list (`:1067`): L2 went from `hidden:50` to `hidden:0` right after `DELETE /api/lists/L1`.
- Variant, several accounts: each new account gets its own 100 (`used:0` on account B). Account creation is limited to 10 per hour per IP (`:982`), nothing else.
- What held: hidden emails are absent from the JSON and the CSV (0 hidden emails found in the raw response). A hidden subscriber cannot be deleted by guessed id (`DELETE .../subscribers/120` -> 404, `:1075`). 40 parallel signups produced a consistent count (130 total, 100 visible).
- Impact: the paid plan can be avoided indefinitely by anyone willing to export then delete. No data-security impact.

### HIGH-2. Upgrading from step 0 strands every existing list (step 1, inherited by 2 and 4). Exploited. Documented by the agent.

- The migration at `step-1/server.js:44-66` rebuilds `lists` without `admin_token` and with `user_id = NULL`.
- Test (`logs/up01.out`): a step-0 data directory (1 list, 22 subscribers) started under step 1.
  - `GET /w/<slug>` -> 200 and `POST /api/w/<slug>/subscribe` -> `{"ok":true,"position":23,...}`: the page keeps collecting emails.
  - `GET /admin/<token>` -> 404, `GET /api/admin/<token>` -> 404, `GET /api/admin/<token>/export.csv` -> 404.
  - New account: `GET /api/lists` -> `"lists":[]`, `GET /api/lists/<slug>` -> 404, `PATCH` -> 404.
- Same result on the chain 0->1->2->4 and on 0->4 directly (`logs/upgrades.out`: `orphan lists: [{"id":1,"user_id":null,...,"subs":22}]`).
- Good side: the step-0 access path is fully closed. No legacy backdoor remains.
- Bad side: the owner can no longer see, export, edit or delete the list, and there is no way to claim it. Recovery needs manual SQL. The README says so plainly ("n'apparaissent donc dans aucun dashboard").
- Upgrades 1->2 and 2->4 are clean: the old session cookie is still valid, the old password logs in, lists and subscribers are intact, old subscribers receive a referral code at startup (`subs without ref_code: 0`), hidden subscribers stay hidden.

### MEDIUM-1. Rate limits and brute-force protection rest on a spoofable header when `TRUST_PROXY=1` (steps 0 to 4). Exploited.

- `clientIp()` takes the left-most `X-Forwarded-For` value (`step-4/server.js:258-264`), which the client controls behind most proxies.
- With `TRUST_PROXY=1` (`logs/s4-limit.out`): 15 wrong passwords for the same account, each with a different `X-Forwarded-For` -> 401 x 15, never 429. 130 public signups in a row -> 130 x 200.
- Without `TRUST_PROXY` the limits hold: the 9th wrong login -> 429, the 21st signup in a minute -> 429, a spoofed header is ignored (`logs/s1.out`).
- Without `TRUST_PROXY` but behind a proxy, every visitor would share one bucket (20 public signups per minute for the whole site). Read from the code, not tested.
- There is no per-account lockout independent of IP.

### MEDIUM-2. Referral ranking can be inflated with invented addresses (step 4). Exploited. Documented by the agent.

- `logs/s4-ref.out`: a subscriber at position 12 of 12. One friend plus three made-up aliases (`attacker+1@...`) signed up with `ref` -> `{"position":1,"referrals":4}`.
- No email confirmation exists. The only brake is 20 signups per minute per IP (`:1019`).
- Side effect on billing: junk signups count toward the owner's 100 visible subscribers.
- Controls that work: a duplicate email gives no credit, a code from another list is ignored, re-submitting your own email gives nothing, deleting a referee removes the boost (`logs/s4-misc.out`: position 2 -> 7 after the delete).

### MEDIUM-3 (could be argued low). Open redirect after login through a tab character (steps 1, 2, 4). Confirmed at HTTP level and with the WHATWG URL parser, not run in a browser.

- `safeNext()` only rejects the prefixes `//` and `/\` (`step-4/server.js:452-455`). The same test is in `step-4/public/auth.js:7`, followed by `location.href = next` (`:62`).
- `GET /login?next=/%09/evil.example` with a valid session -> `Location: /<TAB>/evil.example` (`logs/s4-ref.out`).
- `new URL("/\t/evil.example", "https://waitlist.example/login").href` -> `https://evil.example/`. Browsers strip tabs the same way.
- `//evil.example`, `/\evil.example` and `https://evil.example` are correctly rejected (-> `/app`). The existing test only covers `//evil.com`.

### LOW

| # | Issue | Steps | How verified | Evidence |
|---|---|---|---|---|
| L1 | The public signup reveals that an email is already on a list. From step 4 it also returns that person's rank and referral code. | 0 to 4 | exploited | `POST /api/w/<slug>/subscribe {"email":"e3@example.com"}` -> `{"already":true,"position":4,"refCode":"kjfsyhcr"}`; `step-4/server.js:530` |
| L2 | Account enumeration through signup. Login is uniform (same message, dummy scrypt, 40 to 46 ms in both cases). | 1 to 4 | exploited | `POST /api/auth/signup` with an existing email -> 409 "Un compte existe déjà"; `:431` |
| L3 | Unhandled exceptions give HTTP 500: malformed cookie on any route, `GET //`, CR/LF in `next`. Generic body, no stack trace, no header injection. | 0 (`//` only), 1 to 4 | exploited | `curl -H 'Cookie: wl_session=%' /` -> 500; `:387`, `:902` |
| L4 | The `Host` header is copied into referral links, CSV links and Stripe return URLs when `APP_URL` is unset. Output is escaped and pages are `no-store`. | 2 (Stripe URLs), 4 | observed | `curl -H 'Host: evil.example' -X POST /w/<slug>` -> `value="http://evil.example/w/...?ref=..."`; `:636-638` |
| L5 | Password policy: scrypt N=16384 (below the current OWASP figure of 2^17), 8 characters minimum, `12345678` accepted, no reset, no change, no email verification. | 1 to 4 | observed and read | hash in DB `scrypt$16384$8$1$...`; `:362`, `:429` |
| L6 | The session cookie gets `Secure` only when TLS is detected. Behind a TLS proxy without `TRUST_PROXY=1` the flag is missing. No HSTS header. | 1 to 4 | observed | plain HTTP: `HttpOnly; SameSite=Lax; Max-Age=2592000`; with `X-Forwarded-Proto: https` and `TRUST_PROXY=1`: `...; Secure`; `:393-394` |
| L7 | The public page says "Désinscription possible à tout moment" but no unsubscribe route exists. | 0 to 4 | read | `step-4/server.js:882`; routes at `:909-1104` |
| L8 | The full ranking is recomputed synchronously on every public signup and status call. | 4 | measured | 5,000-row list: 42 ms per signup (`logs/s4-misc.out`); `:488-505` |

### Informational

- Step 0 protects the dashboard with a 192-bit random token in the URL (`step-0/server.js:209`), stored in clear in the DB and in `localStorage`. Reasonable with no accounts; removed at step 1.
- `STRIPE_API_BASE` (`step-4/server.js:29`) is an undocumented env var that redirects all Stripe calls, secret key included. Only the operator can set it. It is the only test hook: there is no mock or test mode in the request path.
- Any active subscription on the user's Stripe customer grants Pro; the price id is not compared (`:705-732`). Read only.
- `past_due` and `trialing` count as Pro (`:34`). Observed: `past_due` -> `"plan":"pro"`.
- Rate-limit counters live in memory and reset on restart (`:241-256`).

## Detail per item

### 1. Regressions and upgrade path

- Step 0 baseline (`logs/s0.out`): create 201, signup 200, duplicate `already:true`, invalid email 400, dashboard total correct, edit 200, empty title 400, delete subscriber 200, CSV correct, no-JS form works. OK, observed by request.
- Steps 1, 2, 4 (`logs/s1.out`, `logs/s2-general.out`, `logs/s4-general.out`): the same scenario passes on each. A normalised diff between steps shows only added fields (`plan`, `hidden`, `timestamps`, then `referrals`, `refCode`, `referredBy` and three CSV columns). OK, observed by request.
- Upgrade 0->1: FAIL, see HIGH-2. Old access path closed: OK.
- Upgrades 1->2 and 2->4: OK, see the last bullet of HIGH-2.
- Step 4 appends 3 columns to the CSV and changes the meaning of `position` (rank instead of arrival order). Expected from the prompt.

### 2. Access control

Verdict OK on steps 1, 2 and 4, by exploitation attempts (`tools/s1.sh`). Account A against account B's list:

| Request as A | Response |
|---|---|
| `GET /api/lists/<B slug>` | 404 |
| `GET /app/lists/<B slug>` | 404 |
| `GET /api/lists/<B slug>/export.csv` | 404 |
| `PATCH /api/lists/<B slug>` | 404 |
| `DELETE /api/lists/<B slug>` | 404 |
| `DELETE /api/lists/<A slug>/subscribers/<B subscriber id>` | 404 |
| `DELETE /api/lists/<B slug>/subscribers/1` | 404 |

- B's data was checked intact afterwards. `GET /api/lists` as A lists only A's lists.
- Unauthenticated: every `/api/lists*` route -> 401, `/app*` -> 302 to `/login`, the old `/admin/x` and `/api/admin/x` -> 404.
- Public by design: `/`, `/login`, `/signup`, `/w/<slug>`, `POST /api/w/<slug>/subscribe`, `/static/*` (HTML shells and JS only), and from step 4 `GET /api/w/<slug>/status/<code>`.
- Step 4 status route: a code from another list -> 404; 60 requests per minute per IP, then 429.
- Ownership check: `ownedList` (`step-4/server.js:152`, `:756-760`); subscriber delete is scoped by `list_id` (`:186`).
- Path traversal on `/static/`: `../server.js`, `..%2f`, `..%5c` -> 404. `/server.js`, `/data/waitlist.db`, `/.env` -> 404.
- Step 0: no accounts. A wrong token -> 404. `/api/lists/summary` only answers for tokens the caller already holds.

### 3. Passwords and sessions (steps 1, 2, 4 identical)

- Storage: `scrypt$16384$8$1$<16-byte salt>$<64-byte key>`, NFKC-normalised, compared with `timingSafeEqual` (`step-4/server.js:362-376`). Observed in the DB.
- Sessions: 256-bit random token. The DB stores only its SHA-256 (`:401`): observed a 64-hex `token_hash`, and the cookie value is not in the DB.
- Cookie: `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`. `Secure` is conditional (L6).
- Logout: the row is deleted server-side. Replaying the old cookie -> `{"user":null}` and 401. Exploit attempt failed: OK.
- Brute force: 8 attempts per IP+email and 30 per IP per 15 minutes (`:988-989`). In the audit run the 9th attempt -> 429, and the correct password is also refused during the window. Case and whitespace variants of the email do not dodge the counter. Weakness: MEDIUM-1.
- Enumeration: L2.
- Sessions survive a restart (they are in SQLite).

### 4. Stripe (steps 2 and 4 identical; `logs/s2-billing.out`)

- Real Checkout: `POST /api/billing/checkout` calls `POST /v1/checkout/sessions` with `mode=subscription`, `customer`, `client_reference_id=<user id>`, `line_items[0][price]=<STRIPE_PRICE_ID>`, `success_url=<base>/app?billing=success`, and returns Stripe's `url`. Captured by the stand-in. A customer is created first, with an idempotency key. OK, observed.
- Webhook signature (`step-4/server.js:683-698`): HMAC-SHA256 over `t.payload` on the raw body, `timingSafeEqual`, 300 s tolerance in both directions.

| Forged request | Response |
|---|---|
| no `Stripe-Signature` | 400 |
| garbage signature | 400 |
| signed with a wrong secret | 400 |
| right secret, timestamp 10 min old | 400 |
| right secret, timestamp 10 min ahead | 400 |
| `v0=` only | 400 |
| valid signature, body altered | 400 |

- The log line "empty secret -> 502" is a mistake in the audit script: bash substituted the real secret, so that request was validly signed and the stand-in had no such subscription. Not an app defect.
- Plan enforced on the server: `planFor()` reads `subscription_status` from the DB on each request (`:538-561`).
- Becoming Pro without paying: every attempt failed.
  - `GET /app?billing=success&session_id=...` -> plan still `free`. The success URL changes nothing server-side; the page only polls.
  - `POST` and `PATCH /api/billing`, `PUT /api/auth/me` -> 404. Extra fields at signup (`subscription_status`, `plan`, `stripe_customer_id`) are ignored.
  - A validly signed `checkout.session.completed` while Stripe reports `incomplete` -> plan `free`. The app re-reads the subscription from Stripe (`:705-732`).
  - A validly signed event with user B's `client_reference_id` but a subscription on A's customer -> B stays `free`.
- Lifecycle: `active` -> pro. `canceled` -> free, and hidden subscribers are hidden again. A second checkout while Pro -> 409.
- No Stripe key: `billingEnabled:false`, checkout and portal -> 503 "Les paiements ne sont pas encore configurés", webhook -> 404. The 100 limit still applies, so nobody can upgrade.
- Stripe erroring during a webhook -> 502, so Stripe retries.

### 5. The 100-subscriber limit

See HIGH-1. Concurrent signups and direct API calls did not bypass it. Delete-and-reveal, list deletion and extra accounts did.

### 6. Secrets

Clean. No hardcoded key, no default fallback secret, no `.env` file in any snapshot. Stripe values come from env only, and billing is off unless all three are set (`step-4/server.js:25-31`). Session tokens are hashed. `.gitignore` excludes `data/`. Only note: the step-0 `admin_token` is stored in clear (informational).

### 7. Persistence

- SQLite file through built-in `node:sqlite`, default `data/waitlist.db`, WAL mode, overridable with `DB_PATH` (`step-4/server.js:13`, `:39-43`).
- Restart test on steps 0, 1, 2, 4: data and sessions were still there after a hard kill. The data sat in the `-wal` file and was read back correctly. OK, observed.
- Copying the data directory must include `waitlist.db-wal`.

### 8. Tests

Run with `node --test`. Ports were remapped into 4120-4129 by `tools/port-preload.mjs`; the test files were not touched.

| Step | Files | Tests | Result |
|---|---|---|---|
| 0 | `test/api.test.js` (63 lines) | 2 | 2 pass |
| 1 | `test/api.test.js` (151) | 6 | 6 pass |
| 2 | + `test/billing.test.js` (198) | 11 | 11 pass |
| 4 | + `test/referral.test.js` (141) | 16 | 16 pass |

- Covered: the full signup, dashboard and export flow; escaping of the title; signup, login, logout; redirects of private pages; isolation between two accounts; the Origin check; webhook signature (unit); hiding beyond 100; checkout, webhook, portal and cancel against an in-process fake Stripe; duplicate and out-of-order webhooks; referral code uniqueness; the +5 rule; the same-list rule; the invite banner; dashboard and CSV columns.
- Not covered: DB migrations and upgrades, restart persistence, rate limits and lockout, the delete-and-reveal bypass, referral abuse, the tab-based open redirect, malformed cookies, the Host header, client-side JS (no browser test), the cookie `Secure` logic.
- All tests are HTTP integration tests against an in-memory DB.

### 9. Other OWASP checks

- Stored and reflected XSS: clean. Payloads in the title, description, email field and `ref` came back escaped on the public page (`&lt;script&gt;`, `value="&quot;&gt;&lt;script&gt;..."`). The dashboard receives JSON and builds the DOM with `textContent`; the only `innerHTML` uses are constant SVG strings (`step-4/public/dashboard.js:221,247,270`). The CSP is `script-src 'self'` and there is no inline script. Client-side rendering was read, not run in a browser.
- CSV formula injection: clean. `=cmd|calc@evil.co` is exported as `'=cmd|calc@evil.co` (`:234-238`).
- SQL injection: clean by reading. Every query is a prepared statement.
- CSRF: clean. A cross-site `Origin` on POST or DELETE -> 403 "Origine refusée", `Origin: null` -> 403, plus `SameSite=Lax`. A request with no `Origin` header is accepted (non-browser clients). Step 0 has no cookies: N/A.
- Open redirect: MEDIUM-3.
- Rate limiting: present on signup, login, public subscribe, list creation, checkout and status. Weakness: MEDIUM-1.
- Information leaks: L1 and L2. Error bodies are generic.
- Security headers on every response: CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`. Missing: HSTS, `Permissions-Policy`.
- Body size limit of 16 KB: a 20 KB JSON body -> 413.

### 10. Decisions nobody asked for

- Stack: zero dependencies, raw `node:http`, `node:sqlite` (experimental), vanilla JS front end, no build step.
- Step 0: dashboard protected by a secret URL; lists remembered in `localStorage`.
- Public slug = slugified title + 6 hex characters. Title max 80, description max 600 characters.
- A honeypot field that returns a fake success to bots.
- Rate limits: 20 signups/min/IP, 10 accounts/h/IP, 8 logins/15 min per IP+email, 30 lists/h/user.
- Passwords: 8 characters minimum, scrypt. Sessions: 30 days, sliding renewal.
- Step-0 lists are orphaned on upgrade instead of being claimable.
- Free plan: the limit is per account across all lists, signups are never refused, subscribers beyond 100 are hidden, counters and chart still include them.
- `past_due` and `trialing` count as Pro. Promotion codes allowed in Checkout. Checkout locale forced to French. A Stripe billing portal was added.
- Referral: +5 places per referee, tie-break rules, 8-character codes, share buttons (WhatsApp, X, LinkedIn, email), code remembered in `localStorage`, a public status endpoint, an "invited by a friend" banner.
- CSV: BOM, formula neutralisation, sorted by rank in step 4 with 3 extra columns.
- Dashboard extras: 7-day counter, chart, search.
- UI and all messages in French only.
- Footer promise "Pas de spam. Désinscription possible à tout moment."

### 11. Size and shape

Stack: Node >= 22.13, ESM, no dependencies, no `node_modules`, one server file, static front end in `public/`.

| File | step 0 | step 1 | step 2 | step 4 |
|---|---|---|---|---|
| `server.js` | 449 | 671 | 942 | 1123 |
| `public/styles.css` | 479 | 544 | 619 | 669 |
| `public/dashboard.js` | 375 | 373 | 392 | 411 |
| `public/dashboard.html` | 133 | 141 | 142 | 146 |
| `public/home.html` | 112 | 76 | 110 | 110 |
| `public/home.js` | 115 | - | - | - |
| `public/app.js` | - | 132 | 155 | 155 |
| `public/app.html` | - | 121 | 122 | 122 |
| `public/auth.js` | - | 70 | 70 | 70 |
| `public/auth.html` | - | 47 | 47 | 47 |
| `public/common.js` | 69 | 70 | 153 | 153 |
| `public/waitlist.js` | 61 | 61 | 61 | 155 |
| `test/api.test.js` | 63 | 151 | 151 | 151 |
| `test/billing.test.js` | - | - | 198 | 198 |
| `test/referral.test.js` | - | - | - | 141 |
| `README.md` | 36 | 49 | 92 | 104 |
| Total (all files) | 1910 | 2524 | 3272 | 3773 |

Largest file at every step: `server.js`. At step 4 it holds the schema, migrations, auth, billing, the HTML template and the router in 1123 lines.

## Not verified

- Anything against the real Stripe API (field names, API version, real Checkout page).
- Behaviour in a real browser: client-side XSS, the tab-based redirect, `SameSite` handling. Checked by reading the JS and with Node's URL parser only.
- Behaviour behind a real reverse proxy (shared rate-limit bucket, `Secure` cookie).
- Load beyond a 5,000-row list.

## Audit hygiene

- One mistake on the auditor's side: a script run with `MSYS_NO_PATHCONV=1` made the server and curl create `C:\c\Users\...\up0to1\` (4 files) outside the audit folder. Those 4 files and the empty folders were removed right away, and the scenario was re-run with correct paths.
- All servers were stopped by PID. Final check: nothing listening on 4100-4149.
