import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';

// --- Faux Stripe : juste ce que l'app utilise --------------------------------
const stripeState = { customers: new Map(), subscriptions: new Map(), calls: [] };
const fakeStripe = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const params = new URLSearchParams(raw);
    stripeState.calls.push({ method: req.method, path: req.url, params, auth: req.headers.authorization });
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== 'Bearer sk_test_fake') return reply(401, { error: { message: 'bad key' } });
    if (req.method === 'POST' && req.url === '/v1/customers') {
      const id = `cus_${stripeState.customers.size + 1}`;
      stripeState.customers.set(id, { id, email: params.get('email') });
      return reply(200, { id });
    }
    if (req.method === 'POST' && req.url === '/v1/checkout/sessions') return reply(200, { id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });
    if (req.method === 'POST' && req.url === '/v1/billing_portal/sessions') return reply(200, { url: 'https://billing.stripe.test/p_1' });
    const m = req.url.match(/^\/v1\/subscriptions\/(\w+)$/);
    if (req.method === 'GET' && m && stripeState.subscriptions.has(m[1])) return reply(200, stripeState.subscriptions.get(m[1]));
    reply(404, { error: { message: 'not found' } });
  });
});
await new Promise((r) => fakeStripe.listen(0, r));

process.env.DB_PATH = ':memory:';
process.env.TRUST_PROXY = '1'; // permet de varier l'IP des visiteurs (limite de débit par IP)
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_PRICE_ID = 'price_pro_9eur';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_API_BASE = `http://localhost:${fakeStripe.address().port}`;
const { server, verifyStripeSignature } = await import('../server.js');
let base;

before(() => new Promise((r) => server.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); })));
after(() => new Promise((r) => { server.closeAllConnections(); fakeStripe.close(); server.close(r); }));

// --- Outils ------------------------------------------------------------------
function client() {
  let cookie = '';
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body && JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, data: type.includes('json') ? await res.json() : await res.text() };
  };
}

let userCount = 0;
async function newUser() {
  const req = client();
  const email = `owner${++userCount}@test.fr`;
  assert.equal((await req('/api/auth/signup', { method: 'POST', body: { email, password: 'motdepasse123' } })).status, 201);
  return req;
}

let ip = 0;
async function fill(slug, count, prefix) {
  for (let i = 0; i < count; i++) {
    const res = await fetch(`${base}/api/w/${slug}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.0.${Math.floor(++ip / 250)}.${ip % 250}` },
      body: JSON.stringify({ email: `${prefix}${i}@exemple.com` }),
    });
    assert.equal(res.status, 200);
  }
}

function sendWebhook(event, secret = 'whsec_test') {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return fetch(`${base}/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` }, body: payload });
}

// --- Tests -------------------------------------------------------------------
test('signature des webhooks', () => {
  const payload = Buffer.from('{"id":"evt_1"}');
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', 'whsec_test').update(`${t}.${payload}`).digest('hex');
  assert.equal(verifyStripeSignature(payload, `t=${t},v1=${sig}`, 'whsec_test'), true);
  assert.equal(verifyStripeSignature(payload, `t=${t},v1=${sig}`, 'autre_secret'), false);
  assert.equal(verifyStripeSignature(Buffer.from('{"id":"evt_2"}'), `t=${t},v1=${sig}`, 'whsec_test'), false);
  assert.equal(verifyStripeSignature(payload, `t=${t},v1=${sig}`, 'whsec_test', (t + 600) * 1000), false, 'trop ancien');
  assert.equal(verifyStripeSignature(payload, '', 'whsec_test'), false);
});

test('gratuit : au-delà de 100 inscrits (tous les comptes confondus), les suivants sont masqués', async () => {
  const owner = await newUser();
  const other = await newUser();
  const { data: a } = await owner('/api/lists', { method: 'POST', body: { title: 'Liste A' } });
  const { data: b } = await owner('/api/lists', { method: 'POST', body: { title: 'Liste B' } });
  const { data: c } = await other('/api/lists', { method: 'POST', body: { title: 'Liste C' } });
  await fill(a.slug, 60, 'a');
  await fill(c.slug, 30, 'c'); // un autre compte ne compte pas dans le quota
  await fill(b.slug, 45, 'b');

  const { data: overview } = await owner('/api/lists');
  assert.deepEqual(
    [overview.plan.plan, overview.plan.used, overview.plan.limit, overview.plan.hidden],
    ['free', 105, 100, 5]
  );

  const { data: listB } = await owner(`/api/lists/${b.slug}`);
  assert.equal(listB.total, 45);
  assert.equal(listB.hidden, 5);
  assert.equal(listB.subscribers.length, 40);
  assert.equal(listB.timestamps.length, 45, 'les statistiques comptent tout le monde');
  assert.ok(!listB.subscribers.some((s) => ['b40@exemple.com', 'b44@exemple.com'].includes(s.email)), 'les derniers arrivés sont masqués');

  const csv = await owner(`/api/lists/${b.slug}/export.csv`);
  assert.equal(csv.data.trim().split('\r\n').length, 41, 'en-tête + 40 lignes');
  assert.ok(!csv.data.includes('b44@exemple.com'));

  // La page publique continue d'accepter les inscriptions.
  await fill(b.slug, 1, 'extra');
  assert.equal((await owner('/api/lists')).data.plan.hidden, 6);

  // L'autre compte n'est pas touché.
  const { data: otherOverview } = await other('/api/lists');
  assert.deepEqual([otherOverview.plan.used, otherOverview.plan.hidden], [30, 0]);
});

test('abonnement : Checkout, activation par webhook, portail, résiliation', async () => {
  const owner = await newUser();
  const { data: list } = await owner('/api/lists', { method: 'POST', body: { title: 'Gros succès' } });
  await fill(list.slug, 103, 'g');
  assert.equal((await owner(`/api/lists/${list.slug}`)).data.hidden, 3);

  // 1. Checkout
  const checkout = await owner('/api/billing/checkout', { method: 'POST' });
  assert.equal(checkout.status, 200);
  assert.equal(checkout.data.url, 'https://checkout.stripe.test/cs_1');
  const customerCall = stripeState.calls.find((c) => c.path === '/v1/customers' && c.params.get('email') === `owner${userCount}@test.fr`);
  assert.ok(customerCall, 'client Stripe créé avec l’email du compte');
  const customerId = `cus_${stripeState.customers.size}`;
  const sessionCall = stripeState.calls.findLast((c) => c.path === '/v1/checkout/sessions');
  assert.equal(sessionCall.params.get('mode'), 'subscription');
  assert.equal(sessionCall.params.get('customer'), customerId);
  assert.equal(sessionCall.params.get('line_items[0][price]'), 'price_pro_9eur');
  assert.match(sessionCall.params.get('success_url'), /\/app\?billing=success$/);

  // 2. Webhook mal signé : refusé, rien ne change
  stripeState.subscriptions.set('sub_1', { id: 'sub_1', customer: customerId, status: 'active', cancel_at_period_end: false, items: { data: [{ current_period_end: 1_900_000_000 }] } });
  const forged = await sendWebhook({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_1' } } }, 'whsec_pirate');
  assert.equal(forged.status, 400);
  assert.equal((await owner('/api/billing')).data.plan.plan, 'free');

  // 3. Webhook valide : passage en Pro, tout devient visible
  const ok = await sendWebhook({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_1' } } });
  assert.equal(ok.status, 200);
  const { data: pro } = await owner('/api/billing');
  assert.deepEqual([pro.plan.plan, pro.plan.limit, pro.plan.hidden, pro.plan.periodEnd], ['pro', null, 0, 1_900_000_000_000]);
  const { data: dash } = await owner(`/api/lists/${list.slug}`);
  assert.deepEqual([dash.hidden, dash.subscribers.length], [0, 103]);

  // 4. Déjà Pro : pas de second abonnement ; le portail est disponible
  assert.equal((await owner('/api/billing/checkout', { method: 'POST' })).status, 409);
  assert.equal((await owner('/api/billing/portal', { method: 'POST' })).data.url, 'https://billing.stripe.test/p_1');

  // 5. Résiliation programmée : toujours Pro jusqu'à la fin de la période
  stripeState.subscriptions.set('sub_1', { ...stripeState.subscriptions.get('sub_1'), cancel_at_period_end: true });
  await sendWebhook({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } });
  const { data: canceling } = await owner('/api/billing');
  assert.deepEqual([canceling.plan.plan, canceling.plan.cancelAtPeriodEnd], ['pro', true]);

  // 6. Fin de l'abonnement : retour au gratuit, les inscrits au-delà de 100 sont de nouveau masqués
  stripeState.subscriptions.set('sub_1', { ...stripeState.subscriptions.get('sub_1'), status: 'canceled' });
  await sendWebhook({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } });
  assert.equal((await owner('/api/billing')).data.plan.plan, 'free');
  assert.equal((await owner(`/api/lists/${list.slug}`)).data.hidden, 3);
});

test('un webhook en double ou dans le désordre ne réactive pas un abonnement terminé', async () => {
  const owner = await newUser();
  await owner('/api/billing/checkout', { method: 'POST' });
  const customerId = `cus_${stripeState.customers.size}`;
  stripeState.subscriptions.set('sub_2', { id: 'sub_2', customer: customerId, status: 'canceled', items: { data: [{ current_period_end: 1_800_000_000 }] } });
  // L'événement « created » arrive après la résiliation : l'état est relu chez Stripe, donc reste « canceled ».
  await sendWebhook({ type: 'customer.subscription.created', data: { object: { id: 'sub_2', status: 'active' } } });
  assert.equal((await owner('/api/billing')).data.plan.plan, 'free');
});

test('les routes de paiement exigent une connexion', async () => {
  const anon = client();
  assert.equal((await anon('/api/billing')).status, 401);
  assert.equal((await anon('/api/billing/checkout', { method: 'POST' })).status, 401);
  assert.equal((await anon('/api/billing/portal', { method: 'POST' })).status, 401);
});
