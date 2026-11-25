import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.TRUST_PROXY = '1'; // pour varier l'IP des visiteurs (limite de débit par IP)
const { server } = await import('../server.js');
let base;

before(() => new Promise((r) => server.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); })));
after(() => new Promise((r) => { server.closeAllConnections(); server.close(r); }));

let ip = 0;
async function subscribe(slug, email, ref) {
  const res = await fetch(`${base}/api/w/${slug}/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9.0.${++ip}` },
    body: JSON.stringify({ email, ref }),
  });
  return { status: res.status, data: await res.json() };
}
const status = async (slug, code) => {
  const res = await fetch(`${base}/api/w/${slug}/status/${code}`);
  return { status: res.status, data: await res.json() };
};

async function owner() {
  let cookie = '';
  const req = async (path, { method = 'GET', body } = {}) => {
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
  await req('/api/auth/signup', { method: 'POST', body: { email: `owner${Math.random()}@test.fr`, password: 'motdepasse123' } });
  return req;
}

async function listWith(req, title, n, prefix) {
  const { data: list } = await req('/api/lists', { method: 'POST', body: { title } });
  const subs = [];
  for (let i = 0; i < n; i++) subs.push((await subscribe(list.slug, `${prefix}${i}@exemple.com`)).data);
  return { list, subs };
}

test('chaque inscrit reçoit un code de parrainage unique', async () => {
  const req = await owner();
  const { subs } = await listWith(req, 'Codes', 5, 'c');
  const codes = subs.map((s) => s.refCode);
  assert.ok(codes.every((c) => /^[a-z0-9]{8}$/.test(c)));
  assert.equal(new Set(codes).size, 5);
  assert.deepEqual(subs.map((s) => s.position), [1, 2, 3, 4, 5]);
});

test('un filleul fait gagner exactement 5 places à son parrain', async () => {
  const req = await owner();
  const { list, subs } = await listWith(req, 'Classement', 10, 'p');
  const tenth = subs[9];
  assert.equal(tenth.position, 10);

  const friend = await subscribe(list.slug, 'ami@exemple.com', tenth.refCode);
  assert.equal(friend.data.position, 11, 'le filleul arrive en fin de liste');
  const after1 = (await status(list.slug, tenth.refCode)).data;
  assert.deepEqual([after1.position, after1.referrals], [5, 1]);

  await subscribe(list.slug, 'ami2@exemple.com', tenth.refCode.toUpperCase()); // le code est insensible à la casse
  const after2 = (await status(list.slug, tenth.refCode)).data;
  assert.deepEqual([after2.position, after2.referrals], [1, 2], 'le rang ne descend jamais sous 1');

  // Les autres reculent d'autant : l'ancien n°1 est maintenant 2e.
  assert.equal((await status(list.slug, subs[0].refCode)).data.position, 2);
});

test('un parrainage ne compte que pour une vraie nouvelle inscription sur la même liste', async () => {
  const req = await owner();
  const { list, subs } = await listWith(req, 'Triche', 3, 't');
  const { list: other, subs: otherSubs } = await listWith(req, 'Autre liste', 1, 'o');
  const code = subs[2].refCode;

  // Se réinscrire avec son propre lien, ou réinscrire quelqu'un de déjà présent : rien.
  assert.equal((await subscribe(list.slug, 't2@exemple.com', code)).data.already, true);
  assert.equal((await subscribe(list.slug, 't0@exemple.com', code)).data.already, true);
  // Un code d'une autre liste, ou un code invalide : ignoré, l'inscription passe quand même.
  assert.equal((await subscribe(list.slug, 'x@exemple.com', otherSubs[0].refCode)).status, 200);
  assert.equal((await subscribe(list.slug, 'y@exemple.com', 'pas-un-code')).status, 200);
  assert.equal((await status(list.slug, code)).data.referrals, 0);
  assert.equal((await status(other.slug, otherSubs[0].refCode)).data.referrals, 0);

  // Le statut n'est accessible que sur la bonne liste.
  assert.equal((await status(other.slug, code)).status, 404);
  assert.equal((await status(list.slug, 'zzzzzzzz')).status, 404);
});

test('page publique : bannière d’invitation et formulaire sans JavaScript', async () => {
  const req = await owner();
  const { list, subs } = await listWith(req, 'Page', 2, 'w');
  const code = subs[1].refCode;

  const invitedPage = await fetch(`${base}/w/${list.slug}?ref=${code}`).then((r) => r.text());
  assert.ok(invitedPage.includes('data-invited'));
  assert.ok(invitedPage.includes(`name="ref" value="${code}"`));
  const unknown = await fetch(`${base}/w/${list.slug}?ref=inconnu1`).then((r) => r.text());
  assert.ok(!unknown.includes('data-invited'));
  assert.ok(unknown.includes('name="ref" value=""'));

  const res = await fetch(`${base}/w/${list.slug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': '10.9.9.9' },
    body: `email=nojs%40exemple.com&ref=${code}`,
  });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /\/w\/[a-z0-9-]+\?ref=[a-z0-9]{8}/, 'le lien de parrainage est affiché');
  assert.equal((await status(list.slug, code)).data.referrals, 1);
});

test('dashboard et export : classement, filleuls et lien de chaque inscrit', async () => {
  const req = await owner();
  const { list, subs } = await listWith(req, 'Dashboard', 4, 'd');
  await subscribe(list.slug, 'filleul@exemple.com', subs[3].refCode);

  const { data } = await req(`/api/lists/${list.slug}`);
  assert.equal(data.referred, 1);
  const parrain = data.subscribers.find((s) => s.email === 'd3@exemple.com');
  const filleul = data.subscribers.find((s) => s.email === 'filleul@exemple.com');
  assert.deepEqual([parrain.position, parrain.referrals], [1, 1]);
  assert.equal(filleul.referredBy, 'd3@exemple.com');

  const csv = (await req(`/api/lists/${list.slug}/export.csv`)).data.trim().split('\r\n');
  assert.equal(csv[0].replace('﻿', ''), 'position,email,date_inscription,parrainages,parraine_par,lien_parrainage');
  assert.match(csv[1], new RegExp(`^1,d3@exemple.com,[^,]+,1,,http://localhost:\\d+/w/${list.slug}\\?ref=${subs[3].refCode}$`));
  assert.match(csv[5], /^5,filleul@exemple.com,[^,]+,0,d3@exemple.com,/);

  // Supprimer un faux filleul retire les places gagnées.
  await req(`/api/lists/${list.slug}/subscribers/${filleul.id}`, { method: 'DELETE' });
  assert.deepEqual([(await status(list.slug, subs[3].refCode)).data.position, (await status(list.slug, subs[3].refCode)).data.referrals], [4, 0]);
});
