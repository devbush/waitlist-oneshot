// Waitlist — serveur HTTP sans dépendance (Node >= 22.13, SQLite intégré).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'waitlist.db');

// ---------------------------------------------------------------- Base de données
mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
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

const q = {
  insertList: db.prepare('INSERT INTO lists (slug, admin_token, title, description, created_at) VALUES (?, ?, ?, ?, ?)'),
  listBySlug: db.prepare('SELECT * FROM lists WHERE slug = ?'),
  listByToken: db.prepare('SELECT * FROM lists WHERE admin_token = ?'),
  updateList: db.prepare('UPDATE lists SET title = ?, description = ? WHERE id = ?'),
  insertSub: db.prepare('INSERT INTO subscribers (list_id, email, created_at) VALUES (?, ?, ?) ON CONFLICT (list_id, email) DO NOTHING'),
  subByEmail: db.prepare('SELECT id FROM subscribers WHERE list_id = ? AND email = ?'),
  position: db.prepare('SELECT COUNT(*) AS n FROM subscribers WHERE list_id = ? AND id <= ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM subscribers WHERE list_id = ?'),
  subs: db.prepare('SELECT id, email, created_at FROM subscribers WHERE list_id = ? ORDER BY id DESC'),
  deleteSub: db.prepare('DELETE FROM subscribers WHERE id = ? AND list_id = ?'),
};

// ---------------------------------------------------------------- Utilitaires
const LIMITS = { title: 120, description: 1000, email: 254 };
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

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// Limiteur de débit en mémoire, par IP et par action.
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
}, 60_000).unref();

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', // le lien du dashboard contient le jeton secret
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS, ...extra });
  res.end(body);
}
const json = (res, status, data) => send(res, status, JSON.stringify(data), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });

function readJson(req, maxBytes = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { reject(Object.assign(new Error('Requête trop volumineuse'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('JSON invalide'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

// Derrière un reverse proxy (Nginx, Render, Fly…), définir TRUST_PROXY=1 pour lire l'IP réelle.
const clientIp = (req) =>
  (process.env.TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) ||
  req.socket.remoteAddress || 'unknown';

// ---------------------------------------------------------------- Pages
const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8' };
const cache = new Map();
async function file(name) {
  if (process.env.NODE_ENV === 'production' && cache.has(name)) return cache.get(name);
  const content = await readFile(path.join(PUBLIC_DIR, name), 'utf8');
  cache.set(name, content);
  return content;
}

async function renderPublicPage(list) {
  const tpl = await file('waitlist.html');
  const count = q.count.get(list.id).n;
  const description = escapeHtml(list.description).replace(/\n/g, '<br>');
  return tpl
    .replaceAll('{{title}}', escapeHtml(list.title))
    .replaceAll('{{metaDescription}}', escapeHtml(list.description.slice(0, 160)))
    .replaceAll('{{description}}', description)
    .replaceAll('{{slug}}', escapeHtml(list.slug))
    .replaceAll('{{countLabel}}', count === 0
      ? 'Soyez parmi les premiers à rejoindre la liste'
      : `<strong>${count.toLocaleString('fr-FR')}</strong> ${count > 1 ? 'personnes ont' : 'personne a'} déjà rejoint la liste`);
}

// ---------------------------------------------------------------- API
function dashboardPayload(list) {
  return {
    list: { slug: list.slug, title: list.title, description: list.description, created_at: list.created_at },
    total: q.count.get(list.id).n,
    subscribers: q.subs.all(list.id),
  };
}

function csvCell(v) {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // anti-injection de formules dans Excel
  return `"${s.replace(/"/g, '""')}"`;
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

  // POST /api/lists — créer une liste
  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'lists') {
    if (rateLimited(`create:${clientIp(req)}`, 10, 60 * 60_000)) return json(res, 429, { error: 'Trop de listes créées. Réessayez plus tard.' });
    const body = await readJson(req);
    const title = cleanText(body.title, LIMITS.title);
    const description = cleanText(body.description, LIMITS.description);
    if (!title) return json(res, 400, { error: 'Le titre est obligatoire.' });
    const slug = slugify(title);
    const token = randomBytes(24).toString('base64url');
    q.insertList.run(slug, token, title, description, new Date().toISOString());
    return json(res, 201, { slug, token });
  }

  // POST /api/w/:slug/subscribe — inscription publique
  if (req.method === 'POST' && parts.length === 4 && parts[1] === 'w' && parts[3] === 'subscribe') {
    const list = q.listBySlug.get(parts[2]);
    if (!list) return json(res, 404, { error: 'Liste introuvable.' });
    if (rateLimited(`sub:${clientIp(req)}`, 20, 10 * 60_000)) return json(res, 429, { error: 'Trop de tentatives. Patientez quelques minutes.' });
    const body = await readJson(req);
    if (body.website) return json(res, 200, { ok: true, position: null }); // pot de miel anti-bot
    const email = cleanText(body.email, LIMITS.email).toLowerCase();
    if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'Adresse email invalide.' });
    const result = q.insertSub.run(list.id, email, new Date().toISOString());
    const already = result.changes === 0;
    const id = already ? q.subByEmail.get(list.id, email).id : Number(result.lastInsertRowid);
    const position = q.position.get(list.id, id).n;
    return json(res, already ? 200 : 201, { ok: true, already, position });
  }

  // /api/d/:token[...] — dashboard (protégé par le jeton secret)
  if (parts[1] === 'd' && parts[2]) {
    const list = q.listByToken.get(parts[2]);
    if (!list) return json(res, 404, { error: 'Dashboard introuvable.' });

    if (parts.length === 3 && req.method === 'GET') return json(res, 200, dashboardPayload(list));

    if (parts.length === 3 && req.method === 'PATCH') {
      const body = await readJson(req);
      const title = cleanText(body.title, LIMITS.title);
      const description = cleanText(body.description, LIMITS.description);
      if (!title) return json(res, 400, { error: 'Le titre est obligatoire.' });
      q.updateList.run(title, description, list.id);
      return json(res, 200, dashboardPayload({ ...list, title, description }));
    }

    if (parts.length === 5 && parts[3] === 'subscribers' && req.method === 'DELETE') {
      q.deleteSub.run(Number(parts[4]), list.id);
      return json(res, 200, dashboardPayload(list));
    }

    if (parts.length === 4 && parts[3] === 'export.csv' && req.method === 'GET') {
      const rows = q.subs.all(list.id).reverse();
      const csv = ['"#","email","inscrit_le"', ...rows.map((r, i) => [i + 1, r.email, r.created_at].map(csvCell).join(','))].join('\r\n');
      return send(res, 200, '﻿' + csv, 'text/csv; charset=utf-8', {
        'Content-Disposition': `attachment; filename="${list.slug}-inscrits.csv"`,
        'Cache-Control': 'no-store',
      });
    }
  }

  return json(res, 404, { error: 'Route inconnue.' });
}

// ---------------------------------------------------------------- Routeur
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Méthode non autorisée', 'text/plain; charset=utf-8');

    if (url.pathname === '/') return send(res, 200, await file('index.html'));

    const pub = url.pathname.match(/^\/w\/([a-z0-9-]+)\/?$/);
    if (pub) {
      const list = q.listBySlug.get(pub[1]);
      if (!list) return send(res, 404, await file('404.html'));
      return send(res, 200, await renderPublicPage(list), undefined, { 'Cache-Control': 'no-store' });
    }

    if (/^\/d\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
      return send(res, 200, await file('dashboard.html'), undefined, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    }

    const asset = url.pathname.match(/^\/static\/([a-z0-9-]+\.(css|js|svg))$/);
    if (asset) return send(res, 200, await file(asset[1]), MIME[path.extname(asset[1])], { 'Cache-Control': 'no-cache' });

    return send(res, 404, await file('404.html'));
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (url.pathname.startsWith('/api/')) return json(res, status, { error: status === 500 ? 'Erreur serveur.' : err.message });
    return send(res, status, 'Erreur serveur', 'text/plain; charset=utf-8');
  }
});

server.listen(PORT, () => console.log(`Waitlist prêt sur http://localhost:${PORT}`));
