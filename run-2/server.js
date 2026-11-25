import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from './src/db.js';
import * as auth from './src/auth.js';
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
const redirect = (res, location, extra = {}) => {
  res.writeHead(303, { Location: location, 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...extra });
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

/** Les formulaires authentifiés doivent venir de notre propre origine (anti-CSRF, en plus de SameSite=Lax). */
function sameOrigin(req) {
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return true; // clients non-navigateurs : pas de cookie tiers à exploiter
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/** N'accepte que des chemins internes pour la redirection après connexion. */
const safeNext = (v) => (typeof v === 'string' && /^\/(?![/\\])[\w\-./?=&%]*$/.test(v) ? v : '');

/* Limiteur à fenêtre glissante, par IP : record() compte un événement, blocked() teste le seuil. */
function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, ts] of hits) if (ts.every((t) => now - t >= windowMs)) hits.delete(k);
  }, windowMs).unref();
  const ipOf = (req) => req.socket.remoteAddress || 'unknown';
  const recent = (req) => (hits.get(ipOf(req)) || []).filter((t) => Date.now() - t < windowMs);
  return {
    blocked: (req) => recent(req).length >= max,
    record: (req) => hits.set(ipOf(req), [...recent(req), Date.now()]),
  };
}
const subscribeLimit = limiter(8, 60_000); // inscriptions sur une page publique
const authFailLimit = limiter(10, 15 * 60_000); // échecs de connexion / inscription

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

  /* ---------- Page publique d'une liste (aucun compte requis) */
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
      if (subscribeLimit.blocked(req)) return respond('limit', 429);
      subscribeLimit.record(req);
      if (!EMAIL_RE.test(email)) return respond('invalid', 400);
      const isNew = db.addSubscriber(list.id, email);
      return respond(isNew ? 'ok' : 'already', isNew ? 201 : 200);
    }
  }

  // Toutes les autres actions POST exigent une requête de même origine.
  if (m === 'POST' && !sameOrigin(req)) return html(res, views.notFound('Requête refusée.', '403'), 403);

  const user = auth.currentUser(req);
  const loginRedirect = () => redirect(res, `/login?next=${encodeURIComponent(p)}`);

  /* ---------- Accueil */
  if (p === '/' && m === 'GET') return user ? redirect(res, '/lists') : html(res, views.home());

  /* ---------- Inscription / connexion / déconnexion */
  if (p === '/signup' || p === '/login') {
    const mode = p.slice(1);
    if (m === 'GET') {
      if (user) return redirect(res, '/lists');
      return html(res, views.authPage({ mode, next: safeNext(url.searchParams.get('next')) }));
    }
    if (m === 'POST') {
      const body = await readBody(req);
      const email = str(body.email, 254).toLowerCase();
      const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
      const next = safeNext(body.next);
      const fail = (error, status = 400) => {
        authFailLimit.record(req);
        return html(res, views.authPage({ mode, error, email, next }), status);
      };

      if (authFailLimit.blocked(req)) return fail('Trop de tentatives. Réessayez dans quelques minutes.', 429);

      let userId;
      if (mode === 'signup') {
        if (!EMAIL_RE.test(email)) return fail('Cette adresse email ne semble pas valide.');
        if (password.length < 8) return fail('Le mot de passe doit contenir au moins 8 caractères.');
        const created = db.createUser(email, await auth.hashPassword(password));
        if (!created) return fail('Un compte existe déjà avec cet email. Connectez-vous plutôt.', 409);
        userId = created.id;
      } else {
        const found = db.getUserByEmail(email);
        const ok = await auth.verifyPassword(password, found?.password_hash);
        if (!found || !ok) return fail('Email ou mot de passe incorrect.', 401);
        userId = found.id;
      }
      return redirect(res, next || '/lists', { 'Set-Cookie': auth.startSession(req, userId) });
    }
  }

  if (p === '/logout' && m === 'POST') {
    return redirect(res, '/', { 'Set-Cookie': auth.endSession(req) });
  }

  /* ---------- Mes listes */
  if (p === '/lists' || p === '/lists/') {
    if (!user) return loginRedirect();
    if (m === 'GET') {
      const flags = { deleted: url.searchParams.has('deleted'), claimed: url.searchParams.has('claimed') };
      return html(res, views.listsPage({ user, lists: db.getUserLists(user.id), flags }));
    }
    if (m === 'POST') {
      const body = await readBody(req);
      const title = str(body.title, 80);
      const description = cleanText(body.description, 600);
      if (!title) {
        return html(
          res,
          views.listsPage({ user, lists: db.getUserLists(user.id), error: 'Donnez un titre à votre projet.', values: { title, description } }),
          400
        );
      }
      const list = db.createList(user.id, { title, description });
      return redirect(res, `/lists/${list.slug}?created=1`);
    }
  }

  /* ---------- Dashboard d'une liste (propriétaire uniquement) */
  if ((match = p.match(/^\/lists\/([a-z0-9-]{1,64})(\/.*)?$/))) {
    if (!user) return loginRedirect();
    const list = db.getOwnedList(match[1], user.id);
    // 404 (et non 403) : on ne révèle pas l'existence des listes des autres.
    if (!list) return html(res, views.notFound('Cette liste n’existe pas ou ne vous appartient pas.'), 404);
    const sub = match[2] || '';
    const self = `/lists/${list.slug}`;

    if ((sub === '' || sub === '/') && m === 'GET') {
      const flags = Object.fromEntries(['created', 'saved', 'removed', 'error', 'claimed'].map((k) => [k, url.searchParams.has(k)]));
      return html(res, views.dashboard({ user, list, subscribers: db.getSubscribers(list.id), baseUrl: baseUrl(req), flags }));
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
      return redirect(res, '/lists?deleted=1');
    }

    if ((match = sub.match(/^\/subscribers\/(\d+)\/delete$/)) && m === 'POST') {
      db.deleteSubscriber(list.id, Number(match[1]));
      return redirect(res, `${self}?removed=1`);
    }
  }

  /* ---------- Anciens liens secrets (version sans comptes) : rattachement au compte */
  if ((match = p.match(/^\/admin\/([A-Za-z0-9_-]{20,64})\/?$/)) && m === 'GET') {
    const list = db.getListByLegacyToken(match[1]);
    if (!list) return html(res, views.notFound('Ce lien de dashboard n’est pas valide.'), 404);
    if (!user) return loginRedirect();
    if (list.user_id == null && db.claimList(list.id, user.id)) return redirect(res, `/lists/${list.slug}?claimed=1`);
    if (list.user_id === user.id) return redirect(res, `/lists/${list.slug}`);
    return html(res, views.notFound('Cette liste appartient déjà à un autre compte.'), 404);
  }

  return html(res, views.notFound(), 404);
}

const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) html(res, views.notFound('Une erreur est survenue.', String(status)), status);
  }
});

server.listen(PORT, () => {
  console.log(`✦ Waitlist prête sur http://localhost:${PORT}`);
});
