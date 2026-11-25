// Local stand-in for api.stripe.com (audit only). Never talks to the network.
import http from 'node:http';
import { appendFileSync } from 'node:fs';
const port = Number(process.env.FAKE_PORT);
const log = process.env.FAKE_LOG;
const subs = new Map();
let n = 0;
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c)).on('end', () => {
    appendFileSync(log, `${req.method} ${req.url} auth=${req.headers.authorization || ''} idem=${req.headers['idempotency-key'] || ''} body=${decodeURIComponent(body)}\n`);
    const json = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/__set') { const s = JSON.parse(body); subs.set(s.id, s); return json(200, { ok: true }); }
    if (req.url === '/v1/customers') return json(200, { id: `cus_fake_${++n}` });
    if (req.url === '/v1/checkout/sessions') return json(200, { id: 'cs_test_fake', url: 'https://checkout.stripe.com/c/pay/cs_test_fake' });
    if (req.url === '/v1/billing_portal/sessions') return json(200, { url: 'https://billing.stripe.com/p/session/fake' });
    const m = req.url.match(/^\/v1\/subscriptions\/(.+)$/);
    if (m && subs.has(m[1])) return json(200, subs.get(m[1]));
    json(404, { error: { message: 'not found (fake)' } });
  });
}).listen(port, '127.0.0.1', () => console.log('fake stripe on', port));
