// Local stand-in for api.stripe.com, audit only. Logs every call it receives.
import http from 'node:http';
import { appendFileSync } from 'node:fs';

const PORT = Number(process.argv[2]);
const LOG = process.argv[3];
const customers = new Map();
const sessions = new Map();
const subs = new Map();
let prices = [];
let n = 0;

const send = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      const params = Object.fromEntries(new URLSearchParams(body));
      if (!p.startsWith('/_ctl')) {
        appendFileSync(
          LOG,
          JSON.stringify({ m: req.method, p: req.url, auth: req.headers.authorization, idem: req.headers['idempotency-key'], params }) + '\n'
        );
      }
      let m;
      if (p === '/v1/prices' && req.method === 'GET') return send(res, 200, { data: prices });
      if (p === '/v1/prices' && req.method === 'POST') {
        const price = { id: 'price_fake1', unit_amount: Number(params.unit_amount), currency: params.currency };
        prices = [price];
        return send(res, 200, price);
      }
      if (p === '/v1/customers' && req.method === 'POST') {
        const id = `cus_fake${++n}`;
        customers.set(id, { id, email: params.email });
        return send(res, 200, customers.get(id));
      }
      if (p === '/v1/checkout/sessions' && req.method === 'POST') {
        const id = `cs_test_fake${++n}`;
        sessions.set(id, { id, customer: params.customer, subscription: null, payment_status: 'unpaid', mode: params.mode, url: `https://checkout.stripe.com/c/pay/${id}` });
        return send(res, 200, sessions.get(id));
      }
      if ((m = p.match(/^\/v1\/checkout\/sessions\/([^/]+)$/)) && req.method === 'GET') {
        const s = sessions.get(decodeURIComponent(m[1]));
        return s ? send(res, 200, s) : send(res, 404, { error: { message: 'No such checkout.session' } });
      }
      if ((m = p.match(/^\/v1\/subscriptions\/([^/]+)$/)) && req.method === 'GET') {
        const s = subs.get(decodeURIComponent(m[1]));
        return s ? send(res, 200, s) : send(res, 404, { error: { message: 'No such subscription' } });
      }
      if (p === '/v1/billing_portal/sessions' && req.method === 'POST') {
        return send(res, 200, { url: 'https://billing.stripe.com/p/session/fake' });
      }
      // audit controls: simulate what Stripe would hold after a payment / a cancellation
      if (p === '/_ctl/pay') {
        const s = sessions.get(url.searchParams.get('session'));
        if (!s) return send(res, 404, {});
        const id = `sub_fake${++n}`;
        subs.set(id, { id, customer: s.customer, status: url.searchParams.get('status') || 'active', current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, cancel_at_period_end: false });
        s.subscription = id;
        s.payment_status = 'paid';
        return send(res, 200, { session: s, subscription: subs.get(id) });
      }
      if (p === '/_ctl/sub') {
        const s = subs.get(url.searchParams.get('id'));
        if (!s) return send(res, 404, {});
        s.status = url.searchParams.get('status');
        return send(res, 200, s);
      }
      send(res, 404, { error: { message: 'unknown route in fake' } });
    });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`fake stripe on ${PORT}`));
