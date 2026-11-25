// Local stand-in for api.stripe.com (audit only). Never talks to the real Stripe.
import http from 'node:http';
import { appendFileSync } from 'node:fs';

const PORT = Number(process.env.PORT);
const LOG = process.env.FAKE_LOG;
const sessions = new Map();
const subs = new Map();
let n = 0;

const send = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    appendFileSync(LOG, `${req.method} ${req.url} auth=${req.headers.authorization || ''} body=${decodeURIComponent(body)}\n`);
    const form = new URLSearchParams(body);

    if (p === '/_ctl/pay') {
      const s = sessions.get(url.searchParams.get('session'));
      const id = `sub_fake_${++n}`;
      subs.set(id, { id, object: 'subscription', customer: s.customer, status: url.searchParams.get('status') || 'active', current_period_end: 1900000000, cancel_at_period_end: false });
      s.subscription = id; s.payment_status = 'paid'; s.status = 'complete';
      return send(res, 200, { subscription: id });
    }
    if (p === '/_ctl/sub') {
      const s = subs.get(url.searchParams.get('id'));
      s.status = url.searchParams.get('status');
      return send(res, 200, s);
    }
    if (p === '/_ctl/session') {
      const s = JSON.parse(body);
      sessions.set(s.id, s);
      return send(res, 200, s);
    }
    if (p === '/_ctl/rawsub') {
      const s = JSON.parse(body);
      subs.set(s.id, s);
      return send(res, 200, s);
    }

    if (req.method === 'POST' && p === '/v1/customers') return send(res, 200, { id: `cus_fake_${++n}`, object: 'customer', email: form.get('email') });
    if (req.method === 'POST' && p === '/v1/checkout/sessions') {
      const id = `cs_test_fake_${++n}`;
      const s = { id, object: 'checkout.session', mode: form.get('mode'), customer: form.get('customer'), client_reference_id: form.get('client_reference_id'), subscription: null, payment_status: 'unpaid', status: 'open', url: `https://checkout.stripe.com/c/pay/${id}` };
      sessions.set(id, s);
      return send(res, 200, s);
    }
    let m;
    if (req.method === 'GET' && (m = p.match(/^\/v1\/checkout\/sessions\/(.+)$/))) {
      const s = sessions.get(decodeURIComponent(m[1]));
      return s ? send(res, 200, s) : send(res, 404, { error: { message: 'No such checkout.session' } });
    }
    if (req.method === 'GET' && (m = p.match(/^\/v1\/subscriptions\/(.+)$/))) {
      const s = subs.get(decodeURIComponent(m[1]));
      return s ? send(res, 200, s) : send(res, 404, { error: { message: 'No such subscription' } });
    }
    if (req.method === 'POST' && p === '/v1/billing_portal/sessions') return send(res, 200, { url: 'https://billing.stripe.com/p/session/fake' });
    return send(res, 404, { error: { message: 'unknown fake route' } });
  });
}).listen(PORT, '127.0.0.1');
