import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from './src/db.js';
import * as views from './src/views.js';

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const MAX_BODY = 16 * 1024;

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

/* ---------------------------------------------------------------- helpers */

function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS, ...extra });
  res.end(body);
}
const html = (res, body, status = 200, extra = {}) =>
  send(res, status, body, 'text/html; charset=utf-8', { 'Cache-Control': 'no-store', ...extra });
const json = (res, status, obj) =>
  send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
const redirect = (res, location) => {
  res.writeHead(303, { Location: location, ...SECURITY_HEADERS });
  res.end();
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const type = req.headers['content-type'] || '';
      try {
        if (type.includes('application/json')) resolve(raw ? JSON.parse(raw) : {});
        else resolve(Object.fromEntries(new URLSearchParams(raw)));
      } catch {
        reject(Object.assign(new Error('Bad request'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

const wantsJson = (req) => (req.headers.accept || '').includes('application/json');
const str = (v, max) => (typeof v === 'string' ? v : '').trim().slice(0, max);
const cleanText = (v, max) => str(v, max).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');

function baseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers.host || `localhost:${PORT}`}`;
}

/* Limite simple : 8 inscriptions / minute / IP. */
const hits = new Map();
function rateLimited(req) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 8;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of hits) if (ts.every((t) => now - t >= 60_000)) hits.delete(ip);
}, 60_000).unref();

const csvCell = (v) => {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // anti injection de formules
  return `"${s.replace(/"/g, '""')}"`;
};

async function serveStatic(res, rel) {
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return html(res, views.notFound(), 404);
  try {
    const data = await readFile(file);
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream', {
      'Cache-Control': 'public, max-age=300',
    });
  } catch {
    html(res, views.notFound(), 404);
  }
}

/* ----------------------------------------------------------------- routes */

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const m = req.method;
  let match;

  if (p.startsWith('/static/') && m === 'GET') return serveStatic(res, p.slice('/static/'.length));
  if (p === '/favicon.ico') return serveStatic(res, 'favicon.svg');

  // Accueil + création
  if (p === '/' && m === 'GET') return html(res, views.home());
  if (p === '/create' && m === 'POST') {
    const body = await readBody(req);
    const title = str(body.title, 80);
    const description = cleanText(body.description, 600);
    if (!title) return html(res, views.home({ error: 'Donnez un titre à votre projet.', values: { title, description } }), 400);
    const list = db.createList({ title, description });
    return redirect(res, `/admin/${list.admin_token}?created=1`);
  }

  // Page publique
  if ((match = p.match(/^\/w\/([a-z0-9-]{1,64})\/?$/))) {
    const list = db.getListBySlug(match[1]);
    if (!list) {
      return wantsJson(req)
        ? json(res, 404, { error: 'not_found' })
        : html(res, views.notFound('Cette liste d’attente n’existe pas ou a été supprimée.'), 404);
    }

    if (m === 'GET') {
      const status = url.searchParams.get('status');
      return html(res, views.publicPage({ list, count: db.countSubscribers(list.id), status }));
    }

    if (m === 'POST') {
      const body = await readBody(req);
      const email = str(body.email, 254).toLowerCase();
      const respond = (status, code) =>
        wantsJson(req)
          ? json(res, code, { status, count: db.countSubscribers(list.id) })
          : redirect(res, `/w/${list.slug}?status=${status}`);

      if (str(body.website, 200)) return respond('ok', 200); // honeypot : on fait semblant
      if (rateLimited(req)) return respond('limit', 429);
      if (!EMAIL_RE.test(email)) return respond('invalid', 400);
      const isNew = db.addSubscriber(list.id, email);
      return respond(isNew ? 'ok' : 'already', isNew ? 201 : 200);
    }
  }

  // Dashboard (accès par jeton secret)
  if ((match = p.match(/^\/admin\/([A-Za-z0-9_-]{20,64})(\/.*)?$/))) {
    const list = db.getListByToken(match[1]);
    if (!list) return html(res, views.notFound('Ce lien de dashboard n’est pas valide.'), 404);
    const sub = match[2] || '';
    const self = `/admin/${list.admin_token}`;

    if ((sub === '' || sub === '/') && m === 'GET') {
      const flags = Object.fromEntries(['created', 'saved', 'removed', 'error'].map((k) => [k, url.searchParams.has(k)]));
      return html(
        res,
        views.dashboard({ list, subscribers: db.getSubscribers(list.id), baseUrl: baseUrl(req), flags }),
        200,
        { 'X-Robots-Tag': 'noindex' }
      );
    }

    if (sub === '/export.csv' && m === 'GET') {
      const rows = db.getSubscribers(list.id).reverse();
      const csv = ['email,inscrit_le', ...rows.map((r) => `${csvCell(r.email)},${csvCell(r.created_at)}`)].join('\r\n');
      return send(res, 200, '﻿' + csv, 'text/csv; charset=utf-8', {
        'Content-Disposition': `attachment; filename="inscrits-${list.slug}.csv"`,
        'Cache-Control': 'no-store',
      });
    }

    if (sub === '/edit' && m === 'POST') {
      const body = await readBody(req);
      const title = str(body.title, 80);
      if (!title) return redirect(res, `${self}?error=1`);
      db.updateList(list.id, { title, description: cleanText(body.description, 600) });
      return redirect(res, `${self}?saved=1`);
    }

    if (sub === '/delete' && m === 'POST') {
      db.deleteList(list.id);
      return redirect(res, '/?deleted=1');
    }

    if ((match = sub.match(/^\/subscribers\/(\d+)\/delete$/)) && m === 'POST') {
      db.deleteSubscriber(list.id, Number(match[1]));
      return redirect(res, `${self}?removed=1`);
    }
  }

  return html(res, views.notFound(), 404);
}

const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) html(res, views.notFound('Une erreur est survenue.'), status);
  }
});

server.listen(PORT, () => {
  console.log(`✦ Waitlist prête sur http://localhost:${PORT}`);
});
