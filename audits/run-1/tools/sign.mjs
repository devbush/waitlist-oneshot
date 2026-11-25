// usage: node sign.mjs <secret> <payload> [tsOffsetSeconds] -> prints Stripe-Signature header value
import { createHmac } from 'node:crypto';
const [secret, payload, off = '0'] = process.argv.slice(2);
const t = Math.floor(Date.now() / 1000) + Number(off);
console.log(`t=${t},v1=${createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`);
