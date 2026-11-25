import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'waitlist.db');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

const LIMITS = { title: 80, description: 600, email: 254 };

// ---------------------------------------------------------------------------
// Base de données
// ---------------------------------------------------------------------------
if (DB_PATH !== ':memory:') mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS lists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    admin_token TEXT NOT NULL UNIQUE,
    created_at  INTEGER NOT NULL
  );
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
  insertList: db.prepare('INSERT INTO lists (slug, title, description, admin_token, created_at) VALUES (?, ?, ?, ?, ?)'),
  listBySlug: db.prepare('SELECT * FROM lists WHERE slug = ?'),
  listByToken: db.prepare('SELECT * FROM lists WHERE admin_token = ?'),
  updateList: db.prepare('UPDATE lists SET title = ?, description = ? WHERE id = ?'),
  deleteList: db.prepare('DELETE FROM lists WHERE id = ?'),
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
  if (entry.n > max) throw new HttpError(429, 'Trop de tentatives. Réessayez dans un instant.');
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
}, 60_000).unref();

function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) tooBig = true;
      else chunks.push(chunk);
    });
    req.on('end', () => (tooBig ? reject(new HttpError(413, 'Requête trop volumineuse.')) : resolve(Buffer.concat(chunks).toString('utf8'))));
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

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}
const sendJson = (res, status, data) =>
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
const sendHtml = (res, status, html) =>
  send(res, status, html, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });

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
// Logique métier
// ---------------------------------------------------------------------------
function createList({ title, description }) {
  const t = cleanText(title, LIMITS.title);
  const d = cleanText(description, LIMITS.description);
  if (!t) throw new HttpError(400, 'Le titre est obligatoire.');
  const token = randomBytes(24).toString('base64url');
  const slug = slugify(t);
  q.insertList.run(slug, t, d, token, Date.now());
  return { slug, adminToken: token, title: t, description: d };
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

function adminPayload(list) {
  const rows = q.subs.all(list.id);
  const total = rows.length;
  return {
    list: { title: list.title, description: list.description, slug: list.slug, createdAt: list.created_at },
    total,
    subscribers: rows.map((r, i) => ({ id: Number(r.id), email: r.email, createdAt: Number(r.created_at), position: total - i })),
  };
}

function requireList(token) {
  const list = token && q.listByToken.get(token);
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
<a class="btn btn-primary" href="/">Créer une liste d’attente</a></div></main></body></html>`;
}

// ---------------------------------------------------------------------------
// Routage
// ---------------------------------------------------------------------------
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;
  const method = req.method;
  const ip = clientIp(req);
  let m;

  if (method === 'GET' && pathname === '/') return serveFile(res, 'home.html', { cache: 'no-cache' });
  if (method === 'GET' && pathname === '/favicon.ico') return serveFile(res, 'favicon.svg');
  if (method === 'GET' && (m = pathname.match(/^\/static\/([\w.-]+)$/))) return serveFile(res, m[1]);
  if (method === 'GET' && (m = pathname.match(/^\/admin\/([\w-]+)$/))) {
    requireList(m[1]);
    return serveFile(res, 'dashboard.html', { cache: 'no-store' });
  }

  // Page publique
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

  // API
  if (method === 'POST' && pathname === '/api/lists') {
    rateLimit(`create:${ip}`, 20, 60 * 60_000);
    return sendJson(res, 201, createList(await parseBody(req)));
  }

  if (method === 'POST' && pathname === '/api/lists/summary') {
    const { tokens } = await parseBody(req);
    if (!Array.isArray(tokens)) throw new HttpError(400, 'Paramètre « tokens » manquant.');
    const lists = tokens
      .slice(0, 50)
      .map((token) => {
        const list = typeof token === 'string' && q.listByToken.get(token);
        return list && { token, title: list.title, slug: list.slug, total: countFor(list.id), createdAt: list.created_at };
      })
      .filter(Boolean);
    return sendJson(res, 200, { lists });
  }

  if ((m = pathname.match(/^\/api\/w\/([a-z0-9-]+)\/subscribe$/)) && method === 'POST') {
    rateLimit(`sub:${ip}`, 20, 60_000);
    const list = q.listBySlug.get(m[1]);
    if (!list) throw new HttpError(404, 'Liste introuvable.');
    return sendJson(res, 200, subscribe(list, await parseBody(req)));
  }

  if ((m = pathname.match(/^\/api\/admin\/([\w-]+)$/))) {
    const list = requireList(m[1]);
    if (method === 'GET') return sendJson(res, 200, adminPayload(list));
    if (method === 'PATCH') {
      const body = await parseBody(req);
      const title = body.title === undefined ? list.title : cleanText(body.title, LIMITS.title);
      const description = body.description === undefined ? list.description : cleanText(body.description, LIMITS.description);
      if (!title) throw new HttpError(400, 'Le titre est obligatoire.');
      q.updateList.run(title, description, list.id);
      return sendJson(res, 200, adminPayload(q.listByToken.get(m[1])));
    }
    if (method === 'DELETE') {
      q.deleteList.run(list.id);
      return sendJson(res, 200, { ok: true });
    }
  }

  if ((m = pathname.match(/^\/api\/admin\/([\w-]+)\/subscribers\/(\d+)$/)) && method === 'DELETE') {
    const list = requireList(m[1]);
    const { changes } = q.deleteSub.run(Number(m[2]), list.id);
    if (!changes) throw new HttpError(404, 'Inscrit introuvable.');
    return sendJson(res, 200, { ok: true });
  }

  if ((m = pathname.match(/^\/api\/admin\/([\w-]+)\/export\.csv$/)) && method === 'GET') {
    const list = requireList(m[1]);
    const lines = ['position,email,date_inscription'];
    for (const s of adminPayload(list).subscribers.reverse()) {
      lines.push([s.position, csvCell(s.email), new Date(s.createdAt).toISOString()].join(','));
    }
    const filename = `${list.slug}-inscrits.csv`;
    return send(res, 200, '﻿' + lines.join('\r\n') + '\r\n', {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
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
