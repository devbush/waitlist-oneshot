import crypto from 'node:crypto';
import { promisify } from 'node:util';
import * as db from './db.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const SESSION_COOKIE = 'wl_session';
const SESSION_DAYS = 30;

/* ------------------------------------------------------------ mots de passe */

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

// Hash factice : on fait le même calcul quand l'email n'existe pas,
// pour ne pas révéler par le temps de réponse quels comptes existent.
const DUMMY_HASH = await hashPassword(crypto.randomBytes(16).toString('hex'));

export async function verifyPassword(password, stored = DUMMY_HASH) {
  const [algo, n, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    ...SCRYPT,
    N: Number(n),
  });
  return crypto.timingSafeEqual(key, expected);
}

/* ------------------------------------------------------------------ sessions */

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const isHttps = (req) =>
  req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted || (process.env.BASE_URL || '').startsWith('https:');

function cookie(req, value, maxAge) {
  return [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    ...(isHttps(req) ? ['Secure'] : []),
  ].join('; ');
}

/** Crée une session et renvoie l'en-tête Set-Cookie correspondant. */
export function startSession(req, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.createSession(sha256(token), userId, Date.now() + SESSION_DAYS * 864e5);
  return cookie(req, token, SESSION_DAYS * 86400);
}

/** Supprime la session courante et renvoie l'en-tête Set-Cookie qui efface le cookie. */
export function endSession(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) db.deleteSession(sha256(token));
  return cookie(req, '', 0);
}

/** @returns {{id:number,email:string}|null} */
export function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token || token.length > 100) return null;
  return db.getSessionUser(sha256(token)) || null;
}

setInterval(() => db.purgeExpiredSessions(), 3600_000).unref();
