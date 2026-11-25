/**
 * Client Stripe minimal (API REST, sans dépendance).
 *
 * Variables d'environnement :
 *   STRIPE_SECRET_KEY      clé secrète (sk_test_… / sk_live_…) — obligatoire pour activer le paiement
 *   STRIPE_WEBHOOK_SECRET  secret de signature du endpoint webhook (whsec_…)
 *   STRIPE_PRICE_ID        facultatif : prix à utiliser. Sinon, le prix « waitlist_pro_monthly »
 *                          (9 €/mois) est recherché par lookup_key, et créé s'il n'existe pas.
 *   STRIPE_API_BASE        facultatif : autre URL d'API (tests contre un faux serveur)
 */
import crypto from 'node:crypto';
import { PRO_PRICE_EUR } from './plans.js';

const API = (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/+$/, '');
const PRICE_LOOKUP_KEY = 'waitlist_pro_monthly';

export const enabled = () => Boolean(process.env.STRIPE_SECRET_KEY);

/** Encode un objet imbriqué au format attendu par Stripe : a[b][0][c]=… */
function encode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') encode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function call(method, path, params, { idempotencyKey } = {}) {
  if (!enabled()) throw new Error('Stripe non configuré (STRIPE_SECRET_KEY manquant)');
  const query = method === 'GET' && params ? `?${encode(params)}` : '';
  const res = await fetch(`${API}/v1${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: method === 'POST' ? encode(params || {}).toString() : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Stripe ${res.status} sur ${method} ${path} : ${data.error?.message || 'erreur inconnue'}`);
    err.stripe = data.error;
    throw err;
  }
  return data;
}

/* ------------------------------------------------------------------- prix */

let cachedPriceId = null;
export async function getPriceId() {
  if (process.env.STRIPE_PRICE_ID) return process.env.STRIPE_PRICE_ID;
  if (cachedPriceId) return cachedPriceId;
  const found = await call('GET', '/prices', { lookup_keys: [PRICE_LOOKUP_KEY], active: true, limit: 1 });
  if (found.data?.[0]) return (cachedPriceId = found.data[0].id);
  const price = await call(
    'POST',
    '/prices',
    {
      currency: 'eur',
      unit_amount: PRO_PRICE_EUR * 100,
      recurring: { interval: 'month' },
      lookup_key: PRICE_LOOKUP_KEY,
      product_data: { name: 'Waitlist Pro' },
    },
    { idempotencyKey: `price-${PRICE_LOOKUP_KEY}` }
  );
  console.log(`✦ Prix Stripe créé : ${price.id} (9 €/mois, lookup_key=${PRICE_LOOKUP_KEY})`);
  return (cachedPriceId = price.id);
}

/* --------------------------------------------------------------- appels */

export const createCustomer = (user) =>
  call('POST', '/customers', { email: user.email, metadata: { user_id: String(user.id) } }, { idempotencyKey: `customer-user-${user.id}` });

export async function createCheckoutSession({ user, customerId, baseUrl }) {
  return call('POST', '/checkout/sessions', {
    mode: 'subscription',
    customer: customerId,
    client_reference_id: String(user.id),
    line_items: [{ price: await getPriceId(), quantity: 1 }],
    subscription_data: { metadata: { user_id: String(user.id) } },
    allow_promotion_codes: true,
    success_url: `${baseUrl}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/billing?checkout=cancel`,
  });
}

export const createPortalSession = ({ customerId, returnUrl }) =>
  call('POST', '/billing_portal/sessions', { customer: customerId, return_url: returnUrl });

export const getCheckoutSession = (id) => call('GET', `/checkout/sessions/${encodeURIComponent(id)}`);
export const getSubscription = (id) => call('GET', `/subscriptions/${encodeURIComponent(id)}`);

/** Extrait ce qui nous intéresse d'un objet Subscription (compatible anciennes et nouvelles versions d'API). */
export function subscriptionState(sub) {
  return {
    id: sub.id,
    status: sub.status,
    // Depuis l'API 2025-03-31, la fin de période est portée par les items de l'abonnement.
    periodEnd: sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end || sub.cancel_at),
  };
}

/* ---------------------------------------------------------------- webhooks */

/**
 * Vérifie l'en-tête Stripe-Signature (HMAC-SHA256 de « t.payload ») et renvoie l'événement,
 * ou null si la signature est absente, invalide ou trop ancienne (rejeu).
 */
export function verifyWebhook(rawBody, header, secret = process.env.STRIPE_WEBHOOK_SECRET, toleranceSec = 300) {
  if (!secret || typeof header !== 'string') return null;
  let t = null;
  const v1 = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2).map((x) => x?.trim());
    if (k === 't') t = v;
    else if (k === 'v1' && v) v1.push(v);
  }
  if (!t || !/^\d+$/.test(t) || !v1.length) return null;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
  const ok = v1.some((sig) => sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
  if (!ok) return null;
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch {
    return null;
  }
}
