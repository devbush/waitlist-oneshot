import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { FREE_LIMIT, isPro } from './plans.js';

export { FREE_LIMIT, isPro };

const dbPath = process.env.DB_PATH || path.resolve('data', 'waitlist.db');
mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS lists (
    id          INTEGER PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    admin_token TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS subscribers (
    id         INTEGER PRIMARY KEY,
    list_id    INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    email      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (list_id, email)
  );
  CREATE INDEX IF NOT EXISTS idx_subscribers_list ON subscribers(list_id, created_at);
`);

// Migration : les listes de la version sans comptes n'ont pas de propriétaire (user_id NULL).
// Elles peuvent être rattachées à un compte via leur ancien lien secret /admin/<jeton>.
if (!db.prepare('PRAGMA table_info(lists)').all().some((c) => c.name === 'user_id')) {
  db.exec('ALTER TABLE lists ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_lists_user ON lists(user_id, created_at)');

// Migration : colonnes d'abonnement Stripe sur les comptes.
{
  const cols = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
  const add = (name, type) => !cols.has(name) && db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
  add('stripe_customer_id', 'TEXT');
  add('stripe_subscription_id', 'TEXT');
  add('subscription_status', 'TEXT'); // statut Stripe brut : active, trialing, past_due, canceled…
  add('current_period_end', 'INTEGER'); // timestamp Unix (secondes)
  add('cancel_at_period_end', 'INTEGER NOT NULL DEFAULT 0');
  if (!db.prepare('PRAGMA table_info(subscribers)').all().some((c) => c.name === 'locked')) {
    // 1 = inscrit reçu au-delà du quota gratuit : email masqué tant que le compte n'est pas Pro.
    // Fixé à l'inscription, pour qu'on ne puisse pas « faire de la place » en supprimant des inscrits visibles.
    db.exec('ALTER TABLE subscribers ADD COLUMN locked INTEGER NOT NULL DEFAULT 0');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_customer ON users(stripe_customer_id)');
}



const q = {
  // utilisateurs & sessions
  insertUser: db.prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
  sessionUser: db.prepare(
    `SELECT u.id, u.email, u.stripe_customer_id, u.stripe_subscription_id, u.subscription_status,
            u.current_period_end, u.cancel_at_period_end
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`
  ),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),

  // abonnement
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByCustomer: db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?'),
  setCustomer: db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?'),
  setSubscription: db.prepare(
    'UPDATE users SET stripe_subscription_id = ?, subscription_status = ?, current_period_end = ?, cancel_at_period_end = ? WHERE id = ?'
  ),
  unlockAll: db.prepare('UPDATE subscribers SET locked = 0 WHERE locked = 1 AND list_id IN (SELECT id FROM lists WHERE user_id = ?)'),
  usage: db.prepare(`
    SELECT COUNT(s.id) AS total, COALESCE(SUM(s.locked), 0) AS locked
    FROM lists l JOIN subscribers s ON s.list_id = l.id WHERE l.user_id = ?`),
  listOwner: db.prepare('SELECT u.id, u.subscription_status FROM lists l JOIN users u ON u.id = l.user_id WHERE l.id = ?'),

  // listes
  insertList: db.prepare(
    'INSERT INTO lists (slug, admin_token, title, description, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  slugExists: db.prepare('SELECT 1 FROM lists WHERE slug = ?'),
  bySlug: db.prepare('SELECT * FROM lists WHERE slug = ?'),
  ownedBySlug: db.prepare('SELECT * FROM lists WHERE slug = ? AND user_id = ?'),
  byToken: db.prepare('SELECT * FROM lists WHERE admin_token = ?'),
  claim: db.prepare('UPDATE lists SET user_id = ? WHERE id = ? AND user_id IS NULL'),
  userLists: db.prepare(`
    SELECT l.id, l.slug, l.title, l.created_at,
           COUNT(s.id) AS total,
           COALESCE(SUM(s.locked), 0) AS locked,
           SUM(CASE WHEN s.created_at >= ? THEN 1 ELSE 0 END) AS week,
           MAX(s.created_at) AS last_at
    FROM lists l LEFT JOIN subscribers s ON s.list_id = l.id
    WHERE l.user_id = ?
    GROUP BY l.id
    ORDER BY l.created_at DESC`),
  updateList: db.prepare('UPDATE lists SET title = ?, description = ? WHERE id = ?'),
  deleteList: db.prepare('DELETE FROM lists WHERE id = ?'),

  // inscrits
  count: db.prepare('SELECT COUNT(*) AS n FROM subscribers WHERE list_id = ?'),
  insertSub: db.prepare('INSERT OR IGNORE INTO subscribers (list_id, email, created_at, locked) VALUES (?, ?, ?, ?)'),
  subs: db.prepare(
    'SELECT id, email, created_at, locked FROM subscribers WHERE list_id = ? ORDER BY created_at DESC, id DESC'
  ),
  deleteSub: db.prepare('DELETE FROM subscribers WHERE id = ? AND list_id = ?'),
};

/* ------------------------------------------------------------ utilisateurs */

/** @returns l'utilisateur créé, ou null si l'email est déjà pris */
export function createUser(email, passwordHash) {
  try {
    const { lastInsertRowid } = q.insertUser.run(email, passwordHash, new Date().toISOString());
    return { id: Number(lastInsertRowid), email };
  } catch (err) {
    if (/UNIQUE/.test(err.message)) return null;
    throw err;
  }
}
export const getUserByEmail = (email) => q.userByEmail.get(email);

export const createSession = (tokenHash, userId, expiresAt) => q.insertSession.run(tokenHash, userId, expiresAt);
export const getSessionUser = (tokenHash) => q.sessionUser.get(tokenHash, Date.now());
export const deleteSession = (tokenHash) => q.deleteSession.run(tokenHash);
export const purgeExpiredSessions = () => q.purgeSessions.run(Date.now());

/* ------------------------------------------------------------------ listes */

function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export function createList(userId, { title, description }) {
  const base = slugify(title) || 'liste';
  let slug;
  do {
    slug = `${base}-${crypto.randomBytes(3).toString('hex')}`;
  } while (q.slugExists.get(slug));
  const adminToken = crypto.randomBytes(24).toString('base64url');
  q.insertList.run(slug, adminToken, title, description, new Date().toISOString(), userId);
  return q.bySlug.get(slug);
}

export const getListBySlug = (slug) => q.bySlug.get(slug);
/** Liste appartenant à l'utilisateur, sinon undefined. */
export const getOwnedList = (slug, userId) => q.ownedBySlug.get(slug, userId);
export const getListByLegacyToken = (token) => q.byToken.get(token);
export const claimList = (listId, userId) => q.claim.run(userId, listId).changes > 0;
export const getUserLists = (userId) =>
  q.userLists.all(new Date(Date.now() - 7 * 864e5).toISOString(), userId).map((l) => ({ ...l, week: l.week ?? 0 }));
export const updateList = (id, { title, description }) => q.updateList.run(title, description, id);
export const deleteList = (id) => q.deleteList.run(id);

/* ----------------------------------------------------------------- inscrits */

export const countSubscribers = (listId) => q.count.get(listId).n;
export const getSubscribers = (listId) => q.subs.all(listId);
export const deleteSubscriber = (listId, id) => q.deleteSub.run(id, listId);

/** @returns {boolean} true si nouvel inscrit, false s'il était déjà inscrit */
export function addSubscriber(listId, email) {
  // node:sqlite est synchrone : le comptage et l'insertion ne peuvent pas être entrelacés.
  const owner = q.listOwner.get(listId); // undefined pour une ancienne liste sans propriétaire
  const locked = owner && !isPro(owner) && q.usage.get(owner.id).total >= FREE_LIMIT ? 1 : 0;
  return q.insertSub.run(listId, email, new Date().toISOString(), locked).changes > 0;
}

/* ------------------------------------------------------------- abonnement */

/** @returns {{total:number, locked:number}} inscrits du compte, toutes listes confondues */
export const getUsage = (userId) => q.usage.get(userId);
export const getUserById = (id) => q.userById.get(id);
export const getUserByCustomer = (customerId) => q.userByCustomer.get(customerId);
export const setStripeCustomer = (userId, customerId) => q.setCustomer.run(customerId, userId);

/** Enregistre l'état d'abonnement ; débloque tous les inscrits quand le compte devient Pro. */
export function saveSubscription(userId, { id, status, periodEnd, cancelAtPeriodEnd }) {
  q.setSubscription.run(id, status, periodEnd ?? null, cancelAtPeriodEnd ? 1 : 0, userId);
  if (isPro({ subscription_status: status })) q.unlockAll.run(userId);
}
