import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dbPath = process.env.DB_PATH || path.resolve('data', 'waitlist.db');
mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
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

const q = {
  insertList: db.prepare(
    'INSERT INTO lists (slug, admin_token, title, description, created_at) VALUES (?, ?, ?, ?, ?)'
  ),
  slugExists: db.prepare('SELECT 1 FROM lists WHERE slug = ?'),
  bySlug: db.prepare('SELECT * FROM lists WHERE slug = ?'),
  byToken: db.prepare('SELECT * FROM lists WHERE admin_token = ?'),
  updateList: db.prepare('UPDATE lists SET title = ?, description = ? WHERE id = ?'),
  deleteList: db.prepare('DELETE FROM lists WHERE id = ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM subscribers WHERE list_id = ?'),
  insertSub: db.prepare(
    'INSERT OR IGNORE INTO subscribers (list_id, email, created_at) VALUES (?, ?, ?)'
  ),
  subs: db.prepare(
    'SELECT id, email, created_at FROM subscribers WHERE list_id = ? ORDER BY created_at DESC, id DESC'
  ),
  deleteSub: db.prepare('DELETE FROM subscribers WHERE id = ? AND list_id = ?'),
};

function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export function createList({ title, description }) {
  const base = slugify(title) || 'liste';
  let slug;
  do {
    slug = `${base}-${crypto.randomBytes(3).toString('hex')}`;
  } while (q.slugExists.get(slug));
  const adminToken = crypto.randomBytes(24).toString('base64url');
  q.insertList.run(slug, adminToken, title, description, new Date().toISOString());
  return q.byToken.get(adminToken);
}

export const getListBySlug = (slug) => q.bySlug.get(slug);
export const getListByToken = (token) => q.byToken.get(token);
export const updateList = (id, { title, description }) => q.updateList.run(title, description, id);
export const deleteList = (id) => q.deleteList.run(id);
export const countSubscribers = (listId) => q.count.get(listId).n;
export const getSubscribers = (listId) => q.subs.all(listId);
export const deleteSubscriber = (listId, id) => q.deleteSub.run(id, listId);

/** @returns {boolean} true si nouvel inscrit, false s'il était déjà inscrit */
export function addSubscriber(listId, email) {
  const res = q.insertSub.run(listId, email, new Date().toISOString());
  return res.changes > 0;
}
