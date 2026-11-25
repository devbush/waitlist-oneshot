import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'waitlist.db');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

const LIMITS = { title: 80, description: 600, email: 254, passwordMin: 8, passwordMax: 200 };
const SESSION_COOKIE = 'wl_session';
const SESSION_TTL = 30 * 86_400_000; // 30 jours
const SESSION_RENEW = 15 * 86_400_000; // prolongée si elle expire dans moins de 15 jours

// Facturation : gratuit jusqu'à FREE_LIMIT inscrits (tous les comptes confondus), Pro illimité.
const FREE_LIMIT = 100;
const STRIPE = {
  secretKey: process.env.STRIPE_SECRET_KEY || '',
  priceId: process.env.STRIPE_PRICE_ID || '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  apiBase: (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/+$/, ''),
};
const BILLING_ENABLED = Boolean(STRIPE.secretKey && STRIPE.priceId && STRIPE.webhookSecret);
const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');
// Statuts Stripe qui donnent accès au plan Pro (past_due : Stripe retente le paiement).
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

// ---------------------------------------------------------------------------
// Base de données
// ---------------------------------------------------------------------------
if (DB_PATH !== ':memory:') mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

// Colonnes d'abonnement (ajoutées si la base vient d'une version précédente).
const userColumns = new Set(db.prepare("SELECT name FROM pragma_table_info('users')").all().map((c) => c.name));
for (const [name, type] of [
  ['stripe_customer_id', 'TEXT'],
  ['stripe_subscription_id', 'TEXT'],
  ['subscription_status', 'TEXT'],
  ['current_period_end', 'INTEGER'],
  ['cancel_at_period_end', 'INTEGER NOT NULL DEFAULT 0'],
]) {
  if (!userColumns.has(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_customer ON users(stripe_customer_id)');

// Migration depuis la version sans comptes (colonne admin_token, pas de propriétaire).
// Les anciennes listes sont conservées sans propriétaire : elles restent publiques mais
// n'apparaissent dans aucun compte.
const listColumns = db.prepare("SELECT name FROM pragma_table_info('lists')").all().map((c) => c.name);
if (listColumns.includes('admin_token')) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;
    CREATE TABLE lists_new (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
      slug        TEXT NOT NULL UNIQUE,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL
    );
    INSERT INTO lists_new (id, slug, title, description, created_at) SELECT id, slug, title, description, created_at FROM lists;
    DROP TABLE lists;
    ALTER TABLE lists_new RENAME TO lists;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}
db.exec(`
  CREATE TABLE IF NOT EXISTS lists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
    slug        TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_lists_user ON lists(user_id, created_at);
  CREATE TABLE IF NOT EXISTS subscribers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id    INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    email      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (list_id, email)
  );
  CREATE INDEX IF NOT EXISTS idx_subscribers_list ON subscribers(list_id, id);
`);

const q = {
  // Comptes & sessions
  insertUser: db.prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
  sessionUser: db.prepare(`
    SELECT u.id, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`),
  renewSession: db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),

  // Abonnements
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByCustomer: db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?'),
  setCustomer: db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?'),
  setSubscription: db.prepare(`
    UPDATE users SET stripe_subscription_id = ?, subscription_status = ?, current_period_end = ?, cancel_at_period_end = ?
    WHERE id = ?`),
  usage: db.prepare('SELECT COUNT(*) AS n FROM subscribers s JOIN lists l ON l.id = s.list_id WHERE l.user_id = ?'),
  // Id du N-ième inscrit du compte (ordre d'arrivée, toutes listes confondues).
  nthSubscriber: db.prepare('SELECT s.id FROM subscribers s JOIN lists l ON l.id = s.list_id WHERE l.user_id = ? ORDER BY s.id LIMIT 1 OFFSET ?'),

  // Listes
  insertList: db.prepare('INSERT INTO lists (user_id, slug, title, description, created_at) VALUES (?, ?, ?, ?, ?)'),
  listBySlug: db.prepare('SELECT * FROM lists WHERE slug = ?'),
  ownedList: db.prepare('SELECT * FROM lists WHERE slug = ? AND user_id = ?'),
  listsByUser: db.prepare(`
    SELECT l.slug, l.title, l.created_at,
      (SELECT COUNT(*) FROM subscribers s WHERE s.list_id = l.id) AS total,
      (SELECT COUNT(*) FROM subscribers s WHERE s.list_id = l.id AND s.created_at >= ?) AS week
    FROM lists l WHERE l.user_id = ? ORDER BY l.created_at DESC, l.id DESC`),
  updateList: db.prepare('UPDATE lists SET title = ?, description = ? WHERE id = ?'),
  deleteList: db.prepare('DELETE FROM lists WHERE id = ?'),

  // Inscrits
  count: db.prepare('SELECT COUNT(*) AS n FROM subscribers WHERE list_id = ?'),
  insertSub: db.prepare('INSERT INTO subscribers (list_id, email, created_at) VALUES (?, ?, ?) ON CONFLICT (list_id, email) DO NOTHING'),
  subByEmail: db.prepare('SELECT id FROM subscribers WHERE list_id = ? AND email = ?'),
  position: db.prepare('SELECT COUNT(*) AS n FROM subscribers WHERE list_id = ? AND id <= ?'),
  subs: db.prepare('SELECT id, email, created_at FROM subscribers WHERE list_id = ? ORDER BY id DESC'),
  deleteSub: db.prepare('DELETE FROM subscribers WHERE id = ? AND list_id = ?'),
};

const countFor = (listId) => Number(q.count.get(listId).n);

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function normalizeEmail(raw) {
  const email = String(raw ?? '').trim().toLowerCase();
  if (!email || email.length > LIMITS.email || !EMAIL_RE.test(email)) return null;
  return email;
}

function cleanText(raw, max) {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

function slugify(title) {
  const base = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  const suffix = randomBytes(3).toString('hex');
  return `${base || 'liste'}-${suffix}`;
}

/** Échappe une cellule CSV et neutralise l'injection de formules (=, +, -, @). */
function csvCell(value) {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Limiteur de débit très simple, en mémoire.
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let entry = hits.get(key);
  if (!entry || entry.reset < now) {
    entry = { n: 0, reset: now + windowMs };
    hits.set(key, entry);
  }
  entry.n += 1;
  if (entry.n > max) throw new HttpError(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  q.purgeSessions.run(now);
}, 60_000).unref();

function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function isHttps(req) {
  return Boolean(req.socket.encrypted) || (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').startsWith('https'));
}

async function readBody(req, limit = 16 * 1024) {
  return (await readRawBody(req, limit)).toString('utf8');
}

/** Corps brut, octet pour octet (nécessaire pour vérifier la signature des webhooks Stripe). */
function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) tooBig = true;
      else chunks.push(chunk);
    });
    req.on('end', () => (tooBig ? reject(new HttpError(413, 'Requête trop volumineuse.')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

async function parseBody(req) {
  const raw = await readBody(req);
  const type = String(req.headers['content-type'] || '');
  if (type.includes('application/json')) {
    try {
      const data = JSON.parse(raw || '{}');
      return data && typeof data === 'object' ? data : {};
    } catch {
      throw new HttpError(400, 'JSON invalide.');
    }
  }
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  throw new HttpError(415, 'Type de contenu non supporté.');
}

/** Refuse les requêtes qui modifient des données si elles viennent d'un autre site (CSRF). */
function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'Origine refusée.');
  }
  if (host !== req.headers.host) throw new HttpError(403, 'Origine refusée.');
}

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}
const sendJson = (res, status, data, headers = {}) =>
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
const sendHtml = (res, status, html) =>
  send(res, status, html, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
const redirect = (res, location) => send(res, 302, '', { Location: location, 'Cache-Control': 'no-store' });

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveFile(res, relPath, { cache = 'public, max-age=300' } = {}) {
  const filePath = path.normalize(path.join(PUBLIC_DIR, relPath));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Introuvable.');
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
  } catch {
    throw new HttpError(404, 'Introuvable.');
  }
  const body = await readFile(filePath);
  send(res, 200, body, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': cache });
}

// ---------------------------------------------------------------------------
// Comptes & sessions
// ---------------------------------------------------------------------------
const scryptAsync = promisify(scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1 };

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password.normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scryptAsync(password.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return timingSafeEqual(actual, expected);
}

// Sert à garder un temps de réponse constant quand l'email n'existe pas.
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

function sessionCookie(req, token, maxAgeMs) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (isHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

function startSession(req, userId) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  q.insertSession.run(sha256(token), userId, now, now + SESSION_TTL);
  return sessionCookie(req, token, SESSION_TTL);
}

/** Retourne l'utilisateur connecté (ou null) et prolonge la session si besoin. */
function currentUser(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const now = Date.now();
  const hash = sha256(token);
  const row = q.sessionUser.get(hash, now);
  if (!row) return null;
  if (row.expires_at - now < SESSION_RENEW) {
    q.renewSession.run(now + SESSION_TTL, hash);
    res.setHeader('Set-Cookie', sessionCookie(req, token, SESSION_TTL));
  }
  return { id: Number(row.id), email: row.email };
}

function readCredentials(body) {
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email) throw new HttpError(400, 'Adresse email invalide.');
  return { email, password };
}

async function signup(req, body) {
  const { email, password } = readCredentials(body);
  if (password.length < LIMITS.passwordMin) throw new HttpError(400, `Le mot de passe doit faire au moins ${LIMITS.passwordMin} caractères.`);
  if (password.length > LIMITS.passwordMax) throw new HttpError(400, 'Mot de passe trop long.');
  if (q.userByEmail.get(email)) throw new HttpError(409, 'Un compte existe déjà avec cet email. Connectez-vous.');
  const hash = await hashPassword(password);
  let id;
  try {
    id = Number(q.insertUser.run(email, hash, Date.now()).lastInsertRowid);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new HttpError(409, 'Un compte existe déjà avec cet email. Connectez-vous.');
    throw err;
  }
  return { user: { id, email }, cookie: startSession(req, id) };
}

async function login(req, body) {
  const { email, password } = readCredentials(body);
  const user = q.userByEmail.get(email);
  const ok = await verifyPassword(password.slice(0, LIMITS.passwordMax), user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Email ou mot de passe incorrect.');
  return { user: { id: Number(user.id), email: user.email }, cookie: startSession(req, user.id) };
}

/** N'accepte que des chemins internes pour la redirection après connexion. */
function safeNext(raw) {
  const next = String(raw || '');
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/app';
}

// ---------------------------------------------------------------------------
// Logique métier
// ---------------------------------------------------------------------------
function createList(user, { title, description }) {
  const t = cleanText(title, LIMITS.title);
  const d = cleanText(description, LIMITS.description);
  if (!t) throw new HttpError(400, 'Le titre est obligatoire.');
  const slug = slugify(t);
  q.insertList.run(user.id, slug, t, d, Date.now());
  return { slug, title: t, description: d };
}

function subscribe(list, body) {
  // Pot de miel : les robots remplissent tous les champs.
  if (body.website) return { ok: true, position: countFor(list.id) + 1, already: false };
  const email = normalizeEmail(body.email);
  if (!email) throw new HttpError(400, 'Adresse email invalide.');
  const result = q.insertSub.run(list.id, email, Date.now());
  const { id } = q.subByEmail.get(list.id, email);
  const position = Number(q.position.get(list.id, id).n);
  return { ok: true, position, already: result.changes === 0, total: countFor(list.id) };
}

/**
 * Plan de l'utilisateur. En gratuit, seuls les FREE_LIMIT premiers inscrits du compte
 * (ordre d'arrivée, toutes listes confondues) sont visibles ; les suivants sont enregistrés
 * mais masqués jusqu'au passage en Pro.
 */
function planFor(userId) {
  const user = q.userById.get(userId);
  const pro = ACTIVE_STATUSES.has(user.subscription_status);
  const used = Number(q.usage.get(userId).n);
  let visibleUpTo = Infinity;
  if (!pro) {
    const nth = q.nthSubscriber.get(userId, FREE_LIMIT - 1);
    if (nth) visibleUpTo = Number(nth.id);
  }
  return {
    visibleUpTo,
    info: {
      plan: pro ? 'pro' : 'free',
      limit: pro ? null : FREE_LIMIT,
      used,
      hidden: pro ? 0 : Math.max(0, used - FREE_LIMIT),
      status: user.subscription_status || null,
      periodEnd: user.current_period_end ? Number(user.current_period_end) : null,
      cancelAtPeriodEnd: Boolean(user.cancel_at_period_end),
      hasCustomer: Boolean(user.stripe_customer_id),
      billingEnabled: BILLING_ENABLED,
    },
  };
}

function listPayload(list, plan) {
  const rows = q.subs.all(list.id);
  const total = rows.length;
  const all = rows.map((r, i) => ({ id: Number(r.id), email: r.email, createdAt: Number(r.created_at), position: total - i }));
  const visible = all.filter((s) => s.id <= plan.visibleUpTo);
  return {
    list: { title: list.title, description: list.description, slug: list.slug, createdAt: list.created_at },
    total,
    hidden: total - visible.length,
    // Dates de toutes les inscriptions (masquées comprises) pour les statistiques et le graphique.
    timestamps: all.map((s) => s.createdAt),
    subscribers: visible,
    plan: plan.info,
  };
}

// ---------------------------------------------------------------------------
// Stripe (sans SDK : appels HTTP directs à l'API)
// ---------------------------------------------------------------------------
function formEncode(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') out.push(formEncode(v, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.filter(Boolean).join('&');
}

async function stripeApi(method, path, params, { idempotencyKey } = {}) {
  let res;
  try {
    res = await fetch(`${STRIPE.apiBase}/v1/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${STRIPE.secretKey}`,
        ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: params ? formEncode(params) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.error(`Stripe ${method} ${path} : ${err.message}`);
    throw new HttpError(502, 'Le service de paiement est injoignable. Réessayez dans un instant.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Stripe ${method} ${path} : ${res.status} ${data.error?.message || ''}`);
    throw new HttpError(502, 'Le service de paiement a refusé la demande. Réessayez dans un instant.');
  }
  return data;
}

function requireBilling() {
  if (!BILLING_ENABLED) throw new HttpError(503, 'Les paiements ne sont pas encore configurés sur ce serveur.');
}

function appUrl(req) {
  return APP_URL || `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}`;
}

/** Retourne le client Stripe de l'utilisateur, en le créant au besoin. */
async function ensureCustomer(userId) {
  const user = q.userById.get(userId);
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const customer = await stripeApi(
    'POST',
    'customers',
    { email: user.email, metadata: { user_id: user.id } },
    // Évite de créer deux clients si l'utilisateur clique deux fois.
    { idempotencyKey: `customer-${user.id}-${user.created_at}` }
  );
  q.setCustomer.run(customer.id, user.id);
  return customer.id;
}

async function createCheckout(req, user) {
  requireBilling();
  if (planFor(user.id).info.plan === 'pro') throw new HttpError(409, 'Vous êtes déjà sur le plan Pro.');
  const customer = await ensureCustomer(user.id);
  const base = appUrl(req);
  const session = await stripeApi('POST', 'checkout/sessions', {
    mode: 'subscription',
    customer,
    client_reference_id: user.id,
    line_items: [{ price: STRIPE.priceId, quantity: 1 }],
    subscription_data: { metadata: { user_id: user.id } },
    allow_promotion_codes: 'true',
    locale: 'fr',
    success_url: `${base}/app?billing=success`,
    cancel_url: `${base}/app?billing=cancel`,
  });
  return { url: session.url };
}

async function createPortal(req, user) {
  requireBilling();
  const { stripe_customer_id: customer } = q.userById.get(user.id);
  if (!customer) throw new HttpError(400, 'Aucun abonnement à gérer.');
  const session = await stripeApi('POST', 'billing_portal/sessions', { customer, return_url: `${appUrl(req)}/app` });
  return { url: session.url };
}

/** Vérifie l'en-tête Stripe-Signature (HMAC SHA-256, tolérance de 5 minutes). */
export function verifyStripeSignature(payload, header, secret, now = Date.now()) {
  let timestamp = 0;
  const signatures = [];
  for (const part of String(header || '').split(',')) {
    const [k, v] = part.split('=');
    if (k === 't') timestamp = Number(v);
    else if (k === 'v1' && v) signatures.push(v);
  }
  if (!timestamp || !signatures.length) return false;
  if (Math.abs(now / 1000 - timestamp) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(payload).digest();
  return signatures.some((sig) => {
    const given = Buffer.from(sig, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/**
 * Relit l'abonnement chez Stripe (source de vérité) et met à jour l'utilisateur.
 * Relire plutôt que se fier au contenu de l'événement rend le traitement insensible
 * à l'ordre d'arrivée et aux doublons de webhooks.
 */
async function syncSubscription(subscriptionId, userIdHint) {
  const sub = await stripeApi('GET', `subscriptions/${encodeURIComponent(subscriptionId)}`);
  let user = q.userByCustomer.get(sub.customer);
  if (!user) {
    const candidate = q.userById.get(Number(userIdHint || sub.metadata?.user_id) || 0);
    if (candidate && !candidate.stripe_customer_id) {
      q.setCustomer.run(sub.customer, candidate.id);
      user = q.userById.get(candidate.id);
    }
  }
  if (!user) {
    console.warn(`Stripe : abonnement ${sub.id} sans utilisateur correspondant`);
    return;
  }
  // Un ancien abonnement terminé ne doit pas écraser un abonnement actif plus récent.
  if (
    user.stripe_subscription_id &&
    user.stripe_subscription_id !== sub.id &&
    ACTIVE_STATUSES.has(user.subscription_status) &&
    !ACTIVE_STATUSES.has(sub.status)
  ) return;

  // Selon la version de l'API, la fin de période est sur l'abonnement ou sur ses lignes.
  const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  const cancelAt = sub.cancel_at ?? (sub.cancel_at_period_end ? periodEnd : null);
  const end = cancelAt ?? periodEnd;
  q.setSubscription.run(sub.id, sub.status, end ? end * 1000 : null, cancelAt && sub.status !== 'canceled' ? 1 : 0, user.id);
}

async function handleStripeEvent(event) {
  const object = event.data?.object || {};
  switch (event.type) {
    case 'checkout.session.completed':
      if (object.mode === 'subscription' && object.subscription) await syncSubscription(object.subscription, object.client_reference_id);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await syncSubscription(object.id);
      break;
    default:
      break; // événement non utilisé
  }
}

function requireUser(user) {
  if (!user) throw new HttpError(401, 'Connectez-vous pour continuer.');
  return user;
}

/** Une liste qui n'appartient pas à l'utilisateur est traitée comme inexistante. */
function requireOwnedList(user, slug) {
  const list = q.ownedList.get(slug, user.id);
  if (!list) throw new HttpError(404, 'Liste introuvable.');
  return list;
}

// ---------------------------------------------------------------------------
// Page publique (rendue côté serveur, fonctionne sans JavaScript)
// ---------------------------------------------------------------------------
function formatCount(n) {
  return new Intl.NumberFormat('fr-FR').format(n);
}

function renderWaitlist(list, { count, success, error, email = '' }) {
  const paragraphs = list.description
    ? list.description
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join('')
    : '';
  const proof =
    count > 0
      ? `<strong data-count>${formatCount(count)}</strong> ${count > 1 ? 'personnes ont' : 'personne a'} déjà rejoint la liste`
      : 'Soyez parmi les premiers à rejoindre la liste';

  const successBlock = `
      <div class="wl-success" data-success ${success ? '' : 'hidden'} role="status" aria-live="polite">
        <div class="wl-check" aria-hidden="true">
          <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>
        </div>
        <h2 data-success-title>${success?.already ? 'Vous êtes déjà inscrit·e' : 'C’est noté !'}</h2>
        <p>Vous êtes <strong data-position>n°${success ? formatCount(success.position) : ''}</strong> sur la liste. On vous prévient dès que c’est prêt.</p>
      </div>`;

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(list.title)} — Liste d’attente</title>
  <meta name="description" content="${escapeHtml(list.description.slice(0, 160) || `Rejoignez la liste d’attente de ${list.title}`)}">
  <meta property="og:title" content="${escapeHtml(list.title)}">
  <meta property="og:description" content="${escapeHtml(list.description.slice(0, 200))}">
  <link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/static/styles.css">
  <script src="/static/waitlist.js" defer></script>
</head>
<body class="page-public">
  <div class="mesh" aria-hidden="true"><span></span><span></span><span></span></div>
  <main class="wl">
    <div class="wl-card">
      <span class="pill"><span class="pulse" aria-hidden="true"></span>Liste d’attente ouverte</span>
      <h1 class="wl-title">${escapeHtml(list.title)}</h1>
      ${paragraphs ? `<div class="wl-desc">${paragraphs}</div>` : ''}

      <form class="wl-form" method="post" action="/w/${escapeHtml(list.slug)}" data-form data-slug="${escapeHtml(list.slug)}" ${success ? 'hidden' : ''} novalidate>
        <label class="sr-only" for="email">Votre adresse email</label>
        <div class="wl-field">
          <svg class="wl-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/></svg>
          <input id="email" name="email" type="email" inputmode="email" autocomplete="email" required maxlength="${LIMITS.email}"
                 placeholder="vous@exemple.com" value="${escapeHtml(email)}" ${error ? 'aria-invalid="true"' : ''} aria-describedby="wl-error">
          <button type="submit" class="btn btn-primary">
            <span class="btn-label">Rejoindre</span>
            <span class="spinner" aria-hidden="true"></span>
          </button>
        </div>
        <div class="hp" aria-hidden="true"><label>Site web <input name="website" tabindex="-1" autocomplete="off"></label></div>
        <p class="wl-error" id="wl-error" data-error role="alert">${error ? escapeHtml(error) : ''}</p>
      </form>
      ${successBlock}

      <div class="wl-proof">
        <div class="avatars" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <span data-proof>${proof}</span>
      </div>
    </div>
    <p class="wl-footer">Pas de spam. Désinscription possible à tout moment.</p>
  </main>
</body>
</html>`;
}

function renderNotFound() {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Introuvable</title><link rel="icon" href="/static/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/static/styles.css"></head>
<body class="page-public"><div class="mesh" aria-hidden="true"><span></span><span></span><span></span></div>
<main class="wl"><div class="wl-card center"><span class="pill">Erreur 404</span><h1 class="wl-title">Cette page n’existe pas</h1>
<div class="wl-desc"><p>Le lien est peut-être incorrect, ou la liste a été supprimée.</p></div>
<a class="btn btn-primary" href="/">Retour à l’accueil</a></div></main></body></html>`;
}

// ---------------------------------------------------------------------------
// Routage
// ---------------------------------------------------------------------------
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;
  const method = req.method;
  const ip = clientIp(req);
  const user = currentUser(req, res);
  let m;

  // --- Pages ---------------------------------------------------------------
  if (method === 'GET') {
    if (pathname === '/') return user ? redirect(res, '/app') : serveFile(res, 'home.html', { cache: 'no-cache' });
    if (pathname === '/login' || pathname === '/signup') {
      return user ? redirect(res, safeNext(url.searchParams.get('next'))) : serveFile(res, 'auth.html', { cache: 'no-cache' });
    }
    if (pathname === '/app') {
      return user ? serveFile(res, 'app.html', { cache: 'no-store' }) : redirect(res, '/login?next=/app');
    }
    if ((m = pathname.match(/^\/app\/lists\/([a-z0-9-]+)$/))) {
      if (!user) return redirect(res, `/login?next=${encodeURIComponent(pathname)}`);
      requireOwnedList(user, m[1]);
      return serveFile(res, 'dashboard.html', { cache: 'no-store' });
    }
    if (pathname === '/favicon.ico') return serveFile(res, 'favicon.svg');
    if ((m = pathname.match(/^\/static\/([\w.-]+)$/))) return serveFile(res, m[1]);
  }

  // Page publique d'une liste
  if ((m = pathname.match(/^\/w\/([a-z0-9-]+)$/))) {
    const list = q.listBySlug.get(m[1]);
    if (!list) return sendHtml(res, 404, renderNotFound());
    if (method === 'GET') return sendHtml(res, 200, renderWaitlist(list, { count: countFor(list.id) }));
    if (method === 'POST') {
      // Soumission sans JavaScript (formulaire classique).
      let body = {};
      try {
        rateLimit(`sub:${ip}`, 20, 60_000);
        body = await parseBody(req);
        const result = subscribe(list, body);
        return sendHtml(res, 200, renderWaitlist(list, { count: countFor(list.id), success: result }));
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
        return sendHtml(res, err.status, renderWaitlist(list, { count: countFor(list.id), error: err.message, email: String(body.email ?? '') }));
      }
    }
  }

  // Webhook Stripe : authentifié par signature, pas par cookie ni par Origin.
  if (pathname === '/stripe/webhook' && method === 'POST') {
    if (!BILLING_ENABLED) throw new HttpError(404, 'Introuvable.');
    const payload = await readRawBody(req, 1024 * 1024);
    if (!verifyStripeSignature(payload, req.headers['stripe-signature'], STRIPE.webhookSecret)) {
      return sendJson(res, 400, { error: 'Signature invalide.' });
    }
    let event;
    try {
      event = JSON.parse(payload.toString('utf8'));
    } catch {
      return sendJson(res, 400, { error: 'JSON invalide.' });
    }
    // En cas d'erreur (Stripe injoignable…), la réponse 5xx fait réessayer Stripe plus tard.
    await handleStripeEvent(event);
    return sendJson(res, 200, { received: true });
  }

  // --- API -----------------------------------------------------------------
  if (pathname.startsWith('/api/') && method !== 'GET') checkOrigin(req);

  // Authentification
  if (method === 'POST' && pathname === '/api/auth/signup') {
    rateLimit(`signup:${ip}`, 10, 60 * 60_000);
    const { user: created, cookie } = await signup(req, await parseBody(req));
    return sendJson(res, 201, { user: { email: created.email } }, { 'Set-Cookie': cookie });
  }
  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = await parseBody(req);
    rateLimit(`login:${ip}`, 30, 15 * 60_000);
    rateLimit(`login:${ip}:${String(body.email ?? '').trim().toLowerCase()}`, 8, 15 * 60_000);
    const { user: logged, cookie } = await login(req, body);
    return sendJson(res, 200, { user: { email: logged.email } }, { 'Set-Cookie': cookie });
  }
  if (method === 'POST' && pathname === '/api/auth/logout') {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) q.deleteSession.run(sha256(token));
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }
  if (method === 'GET' && pathname === '/api/auth/me') {
    return sendJson(res, 200, { user: user && { email: user.email } });
  }

  // Facturation
  if (pathname === '/api/billing' && method === 'GET') {
    return sendJson(res, 200, { plan: planFor(requireUser(user).id).info });
  }
  if (pathname === '/api/billing/checkout' && method === 'POST') {
    requireUser(user);
    rateLimit(`checkout:${user.id}`, 10, 10 * 60_000);
    return sendJson(res, 200, await createCheckout(req, user));
  }
  if (pathname === '/api/billing/portal' && method === 'POST') {
    requireUser(user);
    rateLimit(`portal:${user.id}`, 10, 10 * 60_000);
    return sendJson(res, 200, await createPortal(req, user));
  }

  // Inscription publique à une liste
  if ((m = pathname.match(/^\/api\/w\/([a-z0-9-]+)\/subscribe$/)) && method === 'POST') {
    rateLimit(`sub:${ip}`, 20, 60_000);
    const list = q.listBySlug.get(m[1]);
    if (!list) throw new HttpError(404, 'Liste introuvable.');
    return sendJson(res, 200, subscribe(list, await parseBody(req)));
  }

  // Listes de l'utilisateur connecté
  if (pathname === '/api/lists') {
    requireUser(user);
    if (method === 'GET') {
      const lists = q.listsByUser.all(Date.now() - 7 * 86_400_000, user.id).map((l) => ({
        slug: l.slug,
        title: l.title,
        createdAt: Number(l.created_at),
        total: Number(l.total),
        week: Number(l.week),
      }));
      return sendJson(res, 200, { user: { email: user.email }, plan: planFor(user.id).info, lists });
    }
    if (method === 'POST') {
      rateLimit(`create:${user.id}`, 30, 60 * 60_000);
      return sendJson(res, 201, createList(user, await parseBody(req)));
    }
  }

  if ((m = pathname.match(/^\/api\/lists\/([a-z0-9-]+)$/))) {
    const list = requireOwnedList(requireUser(user), m[1]);
    if (method === 'GET') return sendJson(res, 200, { user: { email: user.email }, ...listPayload(list, planFor(user.id)) });
    if (method === 'PATCH') {
      const body = await parseBody(req);
      const title = body.title === undefined ? list.title : cleanText(body.title, LIMITS.title);
      const description = body.description === undefined ? list.description : cleanText(body.description, LIMITS.description);
      if (!title) throw new HttpError(400, 'Le titre est obligatoire.');
      q.updateList.run(title, description, list.id);
      return sendJson(res, 200, { user: { email: user.email }, ...listPayload(q.listBySlug.get(list.slug), planFor(user.id)) });
    }
    if (method === 'DELETE') {
      q.deleteList.run(list.id);
      return sendJson(res, 200, { ok: true });
    }
  }

  if ((m = pathname.match(/^\/api\/lists\/([a-z0-9-]+)\/subscribers\/(\d+)$/)) && method === 'DELETE') {
    const list = requireOwnedList(requireUser(user), m[1]);
    const subId = Number(m[2]);
    if (subId > planFor(user.id).visibleUpTo) throw new HttpError(404, 'Inscrit introuvable.');
    const { changes } = q.deleteSub.run(subId, list.id);
    if (!changes) throw new HttpError(404, 'Inscrit introuvable.');
    return sendJson(res, 200, { ok: true });
  }

  if ((m = pathname.match(/^\/api\/lists\/([a-z0-9-]+)\/export\.csv$/)) && method === 'GET') {
    const list = requireOwnedList(requireUser(user), m[1]);
    const lines = ['position,email,date_inscription'];
    // En gratuit, l'export ne contient que les inscrits visibles.
    for (const s of listPayload(list, planFor(user.id)).subscribers.reverse()) {
      lines.push([s.position, csvCell(s.email), new Date(s.createdAt).toISOString()].join(','));
    }
    return send(res, 200, '﻿' + lines.join('\r\n') + '\r\n', {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${list.slug}-inscrits.csv"`,
      'Cache-Control': 'no-store',
    });
  }

  throw new HttpError(404, 'Introuvable.');
}

export const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (res.headersSent) return res.end();
    const message = status === 500 ? 'Erreur interne du serveur.' : err.message;
    if (String(req.url).startsWith('/api/')) return sendJson(res, status, { error: message });
    if (status === 404) return sendHtml(res, 404, renderNotFound());
    return send(res, status, message, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => console.log(`✓ Waitlist prête sur http://localhost:${PORT}`));
}
