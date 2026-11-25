// Waitlist — serveur HTTP sans dépendance (Node >= 22.13, SQLite intégré).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const scrypt = promisify(scryptCb);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'waitlist.db');
const SESSION_DAYS = 30;

// ---------------------------------------------------------------- Abonnement (Stripe)
const FREE_LIMIT = 100; // inscrits visibles par compte en plan gratuit
const STRIPE = {
  secretKey: process.env.STRIPE_SECRET_KEY || '',
  priceId: process.env.STRIPE_PRICE_ID || '', // prix récurrent : 9 €/mois
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  apiBase: process.env.STRIPE_API_BASE || 'https://api.stripe.com', // surchargeable pour les tests
};
// Sans clé Stripe, les plans sont désactivés : tout le monde est illimité.
const BILLING_ENABLED = Boolean(STRIPE.secretKey && STRIPE.priceId);
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']); // past_due : Stripe retente le paiement

// ---------------------------------------------------------------- Base de données
mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY,
    email          TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    created_at     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS lists (
    id           INTEGER PRIMARY KEY,
    slug         TEXT NOT NULL UNIQUE,
    admin_token  TEXT NOT NULL UNIQUE,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS subscribers (
    id          INTEGER PRIMARY KEY,
    list_id     INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    UNIQUE (list_id, email)
  );
  CREATE INDEX IF NOT EXISTS idx_subscribers_list ON subscribers(list_id, id);
`);
// Migration : les listes créées avant les comptes n'ont pas de propriétaire.
// Elles sont rattachées au compte qui ouvre leur ancien lien secret /d/<jeton>.
if (!db.prepare('PRAGMA table_info(lists)').all().some((c) => c.name === 'user_id')) {
  db.exec('ALTER TABLE lists ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_lists_user ON lists(user_id, id)');
// Migration : colonnes d'abonnement sur les comptes.
{
  const cols = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
  const add = {
    stripe_customer_id: 'TEXT',
    subscription_id: 'TEXT',
    subscription_status: 'TEXT',
    current_period_end: 'INTEGER',
    cancel_at_period_end: 'INTEGER NOT NULL DEFAULT 0',
  };
  for (const [name, type] of Object.entries(add)) if (!cols.has(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_customer ON users(stripe_customer_id)');
}

const q = {
  // Comptes & sessions
  insertUser: db.prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
  sessionUser: db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByCustomer: db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?'),
  setCustomer: db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ? AND stripe_customer_id IS NULL'),
  setSubscription: db.prepare('UPDATE users SET subscription_id = ?, subscription_status = ?, current_period_end = ?, cancel_at_period_end = ? WHERE id = ?'),
  // Quota : nombre d'inscrits du compte, et id du 100e (les plus anciens restent visibles)
  usage: db.prepare('SELECT COUNT(*) AS n FROM subscribers s JOIN lists l ON l.id = s.list_id WHERE l.user_id = ?'),
  cutoff: db.prepare('SELECT s.id FROM subscribers s JOIN lists l ON l.id = s.list_id WHERE l.user_id = ? ORDER BY s.id LIMIT 1 OFFSET ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  // Listes
  insertList: db.prepare('INSERT INTO lists (slug, admin_token, title, description, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?)'),
  listBySlug: db.prepare('SELECT * FROM lists WHERE slug = ?'),
  listByToken: db.prepare('SELECT * FROM lists WHERE admin_token = ?'),
  listsOfUser: db.prepare(`
    SELECT l.slug, l.title, l.description, l.created_at,
           COUNT(s.id) AS total,
           COALESCE(SUM(s.created_at >= ?), 0) AS last7,
           COALESCE(SUM(s.id > ?), 0) AS locked
    FROM lists l LEFT JOIN subscribers s ON s.list_id = l.id
    WHERE l.user_id = ? GROUP BY l.id ORDER BY l.id DESC`),
  claimList: db.prepare('UPDATE lists SET user_id = ? WHERE id = ? AND user_id IS NULL'),
  updateList: db.prepare('UPDATE lists SET title = ?, description = ? WHERE id = ?'),
  deleteList: db.prepare('DELETE FROM lists WHERE id = ?'),
  // Inscrits
  insertSub: db.prepare('INSERT INTO subscribers (list_id, email, created_at) VALUES (?, ?, ?) ON CONFLICT (list_id, email) DO NOTHING'),
  subByEmail: db.prepare('SELECT id FROM subscribers WHERE list_id = ? AND email = ?'),
  position: db.prepare('SELECT COUNT(*) AS n FROM subscribers WHERE list_id = ? AND id <= ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM subscribers WHERE list_id = ?'),
  subs: db.prepare('SELECT id, email, created_at FROM subscribers WHERE list_id = ? ORDER BY id DESC'),
  deleteSub: db.prepare('DELETE FROM subscribers WHERE id = ? AND list_id = ?'),
};

// ---------------------------------------------------------------- Utilitaires
const LIMITS = { title: 120, description: 1000, email: 254, passwordMin: 8, passwordMax: 200 };
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function slugify(title) {
  const base = title
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'liste';
  return `${base}-${randomBytes(3).toString('hex')}`;
}

const cleanText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const cleanEmail = (value) => cleanText(value, LIMITS.email).toLowerCase();

// Limiteur de débit en mémoire, par clé (IP, email…).
const hits = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || now > entry.reset) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  entry.n += 1;
  return entry.n > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  q.purgeSessions.run(now);
}, 60 * 60_000).unref();

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS, ...extra });
  res.end(body);
}
const json = (res, status, data, extra = {}) =>
  send(res, status, JSON.stringify(data), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store', ...extra });
const redirect = (res, location, extra = {}) => { res.writeHead(302, { Location: location, ...extra }); res.end(); };

function readRaw(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { reject(Object.assign(new Error('Requête trop volumineuse'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, maxBytes = 16 * 1024) {
  const raw = await readRaw(req, maxBytes);
  try {
    const body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
    return body && typeof body === 'object' ? body : {};
  } catch { throw Object.assign(new Error('JSON invalide'), { status: 400 }); }
}

// Derrière un reverse proxy (Nginx, Render, Fly…), définir TRUST_PROXY=1 pour lire l'IP et le protocole réels.
const clientIp = (req) =>
  (process.env.TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) ||
  req.socket.remoteAddress || 'unknown';
const isHttps = (req) =>
  req.socket.encrypted || (process.env.TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');

// Redirection post-connexion : chemin interne uniquement (pas de redirection ouverte).
const safeNext = (v) => (typeof v === 'string' && /^\/(?![\/\\])/.test(v) ? v : '/app');

// ---------------------------------------------------------------- Mots de passe & sessions
async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

async function verifyPassword(password, stored) {
  const [, salt, key] = stored.split('$');
  const expected = Buffer.from(key, 'base64url');
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length);
  return timingSafeEqual(actual, expected);
}
// Hash factice : un email inconnu coûte autant de temps qu'un mauvais mot de passe.
const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(req, token, maxAge) {
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
}

function createSession(req, userId) {
  const token = randomBytes(32).toString('base64url');
  q.insertSession.run(sha256(token), userId, Date.now() + SESSION_DAYS * 86400_000);
  return sessionCookie(req, token, SESSION_DAYS * 86400);
}

function currentUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  return q.sessionUser.get(sha256(token), Date.now()) || null;
}

// Anti-CSRF : un navigateur envoie toujours Origin sur une requête cross-site non-GET.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

// ---------------------------------------------------------------- Plans & Stripe
const isPro = (user) => !BILLING_ENABLED || ACTIVE_STATUSES.has(user.subscription_status);

// État du plan : au-delà de FREE_LIMIT, les inscrits les plus récents sont verrouillés
// (ils sont bien enregistrés, mais leurs emails restent masqués jusqu'au passage en Pro).
function planOf(user) {
  const used = q.usage.get(user.id).n;
  const pro = isPro(user);
  const cutoffRow = pro ? null : q.cutoff.get(user.id, FREE_LIMIT - 1);
  return {
    billingEnabled: BILLING_ENABLED,
    pro,
    limit: pro ? null : FREE_LIMIT,
    used,
    locked: pro ? 0 : Math.max(0, used - FREE_LIMIT),
    lastVisibleId: cutoffRow && used > FREE_LIMIT ? cutoffRow.id : null, // null = tout est visible
    status: user.subscription_status || null,
    currentPeriodEnd: user.current_period_end ? user.current_period_end * 1000 : null,
    cancelAtPeriodEnd: Boolean(user.cancel_at_period_end),
  };
}

const publicPlan = ({ lastVisibleId, ...rest }) => rest;
const isLocked = (plan, subscriberId) => plan.lastVisibleId !== null && subscriberId > plan.lastVisibleId;

// Encodage application/x-www-form-urlencoded à la Stripe : a[b][0][c]=…
function stripeForm(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') stripeForm(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe(method, endpoint, params) {
  const res = await fetch(`${STRIPE.apiBase}/v1/${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE.secretKey}`,
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: params ? stripeForm(params) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Stripe ${method} ${endpoint} → ${res.status}`, data.error?.message || '');
    throw Object.assign(new Error('Le service de paiement est indisponible. Réessayez dans un instant.'), { status: 502 });
  }
  return data;
}

// Vérifie l'en-tête Stripe-Signature (HMAC-SHA256 de "timestamp.payload", tolérance 5 min).
function verifyStripeSignature(raw, header) {
  if (!STRIPE.webhookSecret || !header) return false;
  const parts = {};
  const v1 = [];
  for (const item of String(header).split(',')) {
    const [k, v] = item.split('=');
    if (k === 't') parts.t = v;
    if (k === 'v1') v1.push(v);
  }
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = createHmac('sha256', STRIPE.webhookSecret).update(`${t}.`).update(raw).digest();
  return v1.some((sig) => {
    const got = Buffer.from(sig, 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

// Recharge l'abonnement depuis Stripe (source de vérité) et l'enregistre sur le compte.
// Relire l'objet plutôt que se fier au contenu de l'événement évite les soucis d'ordre de livraison.
async function syncSubscription(subscriptionId) {
  const sub = await stripe('GET', `subscriptions/${encodeURIComponent(subscriptionId)}`);
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  const user = customerId && q.userByCustomer.get(customerId);
  if (!user) return null;
  // Un ancien abonnement qui se termine ne doit pas écraser un abonnement plus récent encore actif.
  if (user.subscription_id && user.subscription_id !== sub.id && !ACTIVE_STATUSES.has(sub.status)) return user;
  const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  q.setSubscription.run(sub.id, sub.status, periodEnd, sub.cancel_at_period_end ? 1 : 0, user.id);
  return q.userById.get(user.id);
}

async function handleStripeWebhook(req, res) {
  const raw = await readRaw(req, 1024 * 1024);
  if (!verifyStripeSignature(raw, req.headers['stripe-signature'])) return json(res, 400, { error: 'Signature invalide.' });
  const event = JSON.parse(raw.toString('utf8'));
  const obj = event.data?.object || {};

  if (event.type === 'checkout.session.completed' && obj.mode === 'subscription') {
    const userId = Number(obj.client_reference_id);
    if (userId && obj.customer) q.setCustomer.run(obj.customer, userId);
    if (obj.subscription) await syncSubscription(obj.subscription);
  } else if (event.type.startsWith('customer.subscription.')) {
    await syncSubscription(obj.id);
  }
  return json(res, 200, { received: true });
}

function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  return `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}`;
}

async function handleBilling(req, res, user, action) {
  if (!BILLING_ENABLED) return json(res, 400, { error: 'Les paiements ne sont pas configurés sur ce serveur.' });

  // POST /api/billing/checkout — démarre l'abonnement Pro via Stripe Checkout
  if (action === 'checkout') {
    if (isPro(user)) return json(res, 409, { error: 'Vous êtes déjà abonné·e à Pro.' });
    if (rateLimited(`checkout:${user.id}`, 20, 60 * 60_000)) return json(res, 429, { error: 'Trop de tentatives. Réessayez plus tard.' });
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe('POST', 'customers', { email: user.email, metadata: { user_id: user.id } });
      q.setCustomer.run(customer.id, user.id);
      customerId = q.userById.get(user.id).stripe_customer_id; // en cas de course, garder le premier
    }
    const base = appUrl(req);
    const session = await stripe('POST', 'checkout/sessions', {
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: STRIPE.priceId, quantity: 1 }],
      allow_promotion_codes: 'true',
      subscription_data: { metadata: { user_id: user.id } },
      success_url: `${base}/app/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/app/billing?checkout=cancel`,
    });
    return json(res, 200, { url: session.url });
  }

  // POST /api/billing/sync — au retour de Checkout, n'attend pas le webhook pour activer Pro
  if (action === 'sync') {
    const body = await readJson(req);
    if (typeof body.session_id !== 'string' || !body.session_id.startsWith('cs_')) return json(res, 400, { error: 'Session invalide.' });
    const session = await stripe('GET', `checkout/sessions/${encodeURIComponent(body.session_id)}`);
    if (String(session.client_reference_id) !== String(user.id)) return json(res, 404, { error: 'Session introuvable.' });
    if (session.customer) q.setCustomer.run(session.customer, user.id);
    if (session.subscription) await syncSubscription(typeof session.subscription === 'string' ? session.subscription : session.subscription.id);
    return json(res, 200, { plan: publicPlan(planOf(q.userById.get(user.id))) });
  }

  // POST /api/billing/portal — gérer l'abonnement (carte, factures, résiliation)
  if (action === 'portal') {
    if (!user.stripe_customer_id) return json(res, 400, { error: "Aucun abonnement à gérer pour l'instant." });
    const portal = await stripe('POST', 'billing_portal/sessions', {
      customer: user.stripe_customer_id,
      return_url: `${appUrl(req)}/app/billing`,
    });
    return json(res, 200, { url: portal.url });
  }

  return json(res, 404, { error: 'Route inconnue.' });
}

// ---------------------------------------------------------------- Pages
const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8' };
const cache = new Map();
async function file(name) {
  if (process.env.NODE_ENV === 'production' && cache.has(name)) return cache.get(name);
  const content = await readFile(path.join(PUBLIC_DIR, name), 'utf8');
  cache.set(name, content);
  return content;
}

function fill(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

async function renderPublicPage(list) {
  const count = q.count.get(list.id).n;
  return fill(await file('waitlist.html'), {
    title: escapeHtml(list.title),
    metaDescription: escapeHtml(list.description.slice(0, 160)),
    description: escapeHtml(list.description).replace(/\n/g, '<br>'),
    slug: escapeHtml(list.slug),
    countLabel: count === 0
      ? 'Soyez parmi les premiers à rejoindre la liste'
      : `<strong>${count.toLocaleString('fr-FR')}</strong> ${count > 1 ? 'personnes ont' : 'personne a'} déjà rejoint la liste`,
  });
}

const AUTH_MODES = {
  login: {
    pageTitle: 'Connexion', heading: 'Bon retour 👋', sub: 'Connectez-vous pour retrouver vos listes.',
    submit: 'Se connecter', autocomplete: 'current-password',
    switchText: 'Pas encore de compte ?', switchLabel: 'Créer un compte', switchHref: '/signup',
  },
  signup: {
    pageTitle: 'Créer un compte', heading: 'Créez votre compte', sub: 'Gratuit, sans carte bancaire. Votre première liste en 30 secondes.',
    submit: 'Créer mon compte', autocomplete: 'new-password',
    switchText: 'Déjà un compte ?', switchLabel: 'Se connecter', switchHref: '/login',
  },
};

async function renderAuthPage(mode, next) {
  const m = AUTH_MODES[mode];
  const nextQs = next === '/app' ? '' : `?next=${encodeURIComponent(next)}`;
  return fill(await file('auth.html'), {
    ...Object.fromEntries(Object.entries(m).map(([k, v]) => [k, escapeHtml(v)])),
    mode,
    next: escapeHtml(next),
    switchHref: escapeHtml(m.switchHref + nextQs),
    passwordHint: mode === 'signup' ? `<span class="hint">${LIMITS.passwordMin} caractères minimum.</span>` : '',
  });
}

const renderAppPage = async (name, user) => fill(await file(name), {
  userEmail: escapeHtml(user.email),
  planBadge: !BILLING_ENABLED ? '' : isPro(user)
    ? '<a class="plan-pill pro" href="/app/billing">Pro</a>'
    : '<a class="plan-pill" href="/app/billing">Gratuit</a>',
});

// ---------------------------------------------------------------- API
// Les inscrits verrouillés (plan gratuit au-delà du quota) sont renvoyés sans leur email.
function dashboardPayload(list, user) {
  const plan = planOf(user);
  const subscribers = q.subs.all(list.id).map((s) =>
    isLocked(plan, s.id) ? { id: s.id, email: null, created_at: s.created_at, locked: true } : s);
  return {
    list: { slug: list.slug, title: list.title, description: list.description, created_at: list.created_at },
    total: subscribers.length,
    locked: subscribers.filter((s) => s.locked).length,
    subscribers,
    plan: publicPlan(plan),
  };
}

function csvCell(v) {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // anti-injection de formules dans Excel
  return `"${s.replace(/"/g, '""')}"`;
}

function readListFields(body) {
  const title = cleanText(body.title, LIMITS.title);
  const description = cleanText(body.description, LIMITS.description);
  if (!title) throw Object.assign(new Error('Le titre est obligatoire.'), { status: 400 });
  return { title, description };
}

async function handleAuth(req, res, action) {
  const ip = clientIp(req);

  if (action === 'logout') {
    const token = parseCookies(req).sid;
    if (token) q.deleteSession.run(sha256(token));
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  const body = await readJson(req);
  const email = cleanEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  if (action === 'signup') {
    if (rateLimited(`signup:${ip}`, 10, 60 * 60_000)) return json(res, 429, { error: 'Trop de comptes créés. Réessayez plus tard.' });
    if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'Adresse email invalide.' });
    if (password.length < LIMITS.passwordMin) return json(res, 400, { error: `Le mot de passe doit faire au moins ${LIMITS.passwordMin} caractères.` });
    if (password.length > LIMITS.passwordMax) return json(res, 400, { error: 'Mot de passe trop long.' });
    if (q.userByEmail.get(email)) return json(res, 409, { error: 'Un compte existe déjà avec cet email. Connectez-vous.' });
    const hash = await hashPassword(password);
    let userId;
    try {
      userId = Number(q.insertUser.run(email, hash, new Date().toISOString()).lastInsertRowid);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return json(res, 409, { error: 'Un compte existe déjà avec cet email. Connectez-vous.' });
      throw e;
    }
    return json(res, 201, { ok: true }, { 'Set-Cookie': createSession(req, userId) });
  }

  if (action === 'login') {
    if (rateLimited(`login-ip:${ip}`, 30, 15 * 60_000) || rateLimited(`login-email:${email}`, 10, 15 * 60_000)) {
      return json(res, 429, { error: 'Trop de tentatives. Patientez 15 minutes.' });
    }
    const user = email ? q.userByEmail.get(email) : null;
    const ok = await verifyPassword(password.slice(0, LIMITS.passwordMax), user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) return json(res, 401, { error: 'Email ou mot de passe incorrect.' });
    return json(res, 200, { ok: true }, { 'Set-Cookie': createSession(req, user.id) });
  }

  return json(res, 404, { error: 'Route inconnue.' });
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

  // POST /api/stripe/webhook — appelé par Stripe (authentifié par signature, pas par cookie)
  if (url.pathname === '/api/stripe/webhook' && req.method === 'POST') return handleStripeWebhook(req, res);

  if (req.method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: 'Origine refusée.' });

  // POST /api/auth/(signup|login|logout)
  if (parts[1] === 'auth' && parts.length === 3 && req.method === 'POST') return handleAuth(req, res, parts[2]);

  // POST /api/w/:slug/subscribe — inscription publique (sans compte)
  if (req.method === 'POST' && parts.length === 4 && parts[1] === 'w' && parts[3] === 'subscribe') {
    const list = q.listBySlug.get(parts[2]);
    if (!list) return json(res, 404, { error: 'Liste introuvable.' });
    if (rateLimited(`sub:${clientIp(req)}`, 20, 10 * 60_000)) return json(res, 429, { error: 'Trop de tentatives. Patientez quelques minutes.' });
    const body = await readJson(req);
    if (body.website) return json(res, 200, { ok: true, position: null }); // pot de miel anti-bot
    const email = cleanEmail(body.email);
    if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'Adresse email invalide.' });
    const result = q.insertSub.run(list.id, email, new Date().toISOString());
    const already = result.changes === 0;
    const id = already ? q.subByEmail.get(list.id, email).id : Number(result.lastInsertRowid);
    const position = q.position.get(list.id, id).n;
    return json(res, already ? 200 : 201, { ok: true, already, position });
  }

  // ---- Tout ce qui suit exige une session
  const user = currentUser(req);
  if (!user) return json(res, 401, { error: 'Session expirée. Reconnectez-vous.' });

  if (parts[1] === 'me' && parts.length === 2 && req.method === 'GET') return json(res, 200, { email: user.email, plan: publicPlan(planOf(user)) });

  // POST /api/billing/(checkout|sync|portal)
  if (parts[1] === 'billing' && parts.length === 3 && req.method === 'POST') return handleBilling(req, res, user, parts[2]);

  if (parts[1] !== 'lists') return json(res, 404, { error: 'Route inconnue.' });

  // GET /api/lists — mes listes
  if (parts.length === 2 && req.method === 'GET') {
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const plan = planOf(user);
    const lists = q.listsOfUser.all(since, plan.lastVisibleId ?? Number.MAX_SAFE_INTEGER, user.id);
    return json(res, 200, { lists, plan: publicPlan(plan) });
  }

  // POST /api/lists — créer une liste
  if (parts.length === 2 && req.method === 'POST') {
    if (rateLimited(`create:${user.id}`, 30, 60 * 60_000)) return json(res, 429, { error: 'Trop de listes créées. Réessayez plus tard.' });
    const { title, description } = readListFields(await readJson(req));
    const slug = slugify(title);
    q.insertList.run(slug, randomBytes(24).toString('base64url'), title, description, new Date().toISOString(), user.id);
    return json(res, 201, { slug });
  }

  // POST /api/lists/claim — rattacher une liste créée avant les comptes (via son ancien jeton)
  if (parts.length === 3 && parts[2] === 'claim' && req.method === 'POST') {
    if (rateLimited(`claim:${user.id}`, 50, 60 * 60_000)) return json(res, 429, { error: 'Trop de tentatives.' });
    const body = await readJson(req);
    const list = typeof body.token === 'string' ? q.listByToken.get(body.token) : null;
    if (!list || (list.user_id !== null && list.user_id !== user.id)) return json(res, 404, { error: 'Liste introuvable.' });
    q.claimList.run(user.id, list.id);
    return json(res, 200, { slug: list.slug });
  }

  // /api/lists/:slug[...] — uniquement les listes du compte connecté
  const list = q.listBySlug.get(parts[2]);
  if (!list || list.user_id !== user.id) return json(res, 404, { error: 'Liste introuvable.' });

  if (parts.length === 3) {
    if (req.method === 'GET') return json(res, 200, dashboardPayload(list, user));
    if (req.method === 'PATCH') {
      const { title, description } = readListFields(await readJson(req));
      q.updateList.run(title, description, list.id);
      return json(res, 200, dashboardPayload({ ...list, title, description }, user));
    }
    if (req.method === 'DELETE') {
      q.deleteList.run(list.id);
      return json(res, 200, { ok: true });
    }
  }

  if (parts.length === 5 && parts[3] === 'subscribers' && req.method === 'DELETE') {
    q.deleteSub.run(Number(parts[4]), list.id);
    return json(res, 200, dashboardPayload(list, user));
  }

  if (parts.length === 4 && parts[3] === 'export.csv' && req.method === 'GET') {
    const plan = planOf(user);
    const rows = q.subs.all(list.id).reverse().filter((r) => !isLocked(plan, r.id));
    const csv = ['"#","email","inscrit_le"', ...rows.map((r, i) => [i + 1, r.email, r.created_at].map(csvCell).join(','))].join('\r\n');
    return send(res, 200, '﻿' + csv, 'text/csv; charset=utf-8', {
      'Content-Disposition': `attachment; filename="${list.slug}-inscrits.csv"`,
      'Cache-Control': 'no-store',
    });
  }

  return json(res, 404, { error: 'Route inconnue.' });
}

// ---------------------------------------------------------------- Routeur
const PRIVATE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Méthode non autorisée', 'text/plain; charset=utf-8');

    const asset = p.match(/^\/static\/([a-z0-9-]+\.(css|js|svg))$/);
    if (asset) return send(res, 200, await file(asset[1]), MIME[path.extname(asset[1])], { 'Cache-Control': 'no-cache' });

    const pub = p.match(/^\/w\/([a-z0-9-]+)\/?$/);
    if (pub) {
      const list = q.listBySlug.get(pub[1]);
      if (!list) return send(res, 404, await file('404.html'));
      return send(res, 200, await renderPublicPage(list), undefined, { 'Cache-Control': 'no-store' });
    }

    const user = currentUser(req);

    if (p === '/') return user ? redirect(res, '/app') : send(res, 200, await file('index.html'));

    if (p === '/login' || p === '/signup') {
      const next = safeNext(url.searchParams.get('next'));
      if (user) return redirect(res, next);
      return send(res, 200, await renderAuthPage(p.slice(1), next), undefined, PRIVATE);
    }

    // Pages privées : connexion obligatoire
    const appList = p.match(/^\/app\/lists\/([a-z0-9-]+)\/?$/);
    const legacy = p.match(/^\/d\/([A-Za-z0-9_-]+)\/?$/);
    if (p === '/app' || p === '/app/billing' || appList || legacy) {
      if (!user) return redirect(res, `/login?next=${encodeURIComponent(p)}`);

      if (p === '/app') return send(res, 200, await renderAppPage('app.html', user), undefined, PRIVATE);
      if (p === '/app/billing') return send(res, 200, await renderAppPage('billing.html', user), undefined, PRIVATE);

      if (appList) {
        const list = q.listBySlug.get(appList[1]);
        if (!list || list.user_id !== user.id) return send(res, 404, await file('404.html'));
        return send(res, 200, await renderAppPage('dashboard.html', user), undefined, PRIVATE);
      }

      // Ancien lien secret : rattache la liste au compte si elle n'a pas encore de propriétaire.
      const list = q.listByToken.get(legacy[1]);
      if (!list || (list.user_id !== null && list.user_id !== user.id)) return send(res, 404, await file('404.html'));
      q.claimList.run(user.id, list.id);
      return redirect(res, `/app/lists/${list.slug}`);
    }

    return send(res, 404, await file('404.html'));
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (p.startsWith('/api/')) return json(res, status, { error: status === 500 ? 'Erreur serveur.' : err.message });
    return send(res, status, 'Erreur serveur', 'text/plain; charset=utf-8');
  }
});

q.purgeSessions.run(Date.now());
server.listen(PORT, () => {
  console.log(`Waitlist prêt sur http://localhost:${PORT}`);
  if (!BILLING_ENABLED) console.log('Paiements Stripe désactivés (STRIPE_SECRET_KEY / STRIPE_PRICE_ID absents) : tous les comptes sont illimités.');
  else if (!STRIPE.webhookSecret) console.warn('⚠ STRIPE_WEBHOOK_SECRET absent : les renouvellements et résiliations ne seront pas synchronisés.');
});
