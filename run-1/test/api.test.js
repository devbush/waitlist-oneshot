import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { server } = await import('../server.js');
let base;

before(() => new Promise((r) => server.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); })));
after(() => new Promise((r) => { server.closeAllConnections(); server.close(r); }));

const json = (path, method = 'GET', body) =>
  fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body) })
    .then(async (res) => ({ status: res.status, data: await res.json() }));

test('parcours complet : création, inscription, dashboard, export', async () => {
  const { status, data: list } = await json('/api/lists', 'POST', { title: 'Mon Projet Génial <b>', description: 'Ligne 1\n\nLigne 2' });
  assert.equal(status, 201);
  assert.match(list.slug, /^mon-projet-genial-b-[0-9a-f]{6}$/);

  const page = await fetch(`${base}/w/${list.slug}`).then((r) => r.text());
  assert.ok(page.includes('Mon Projet Génial &lt;b&gt;'), 'titre échappé');
  assert.ok(!page.includes('Génial <b>'));

  const a = await json(`/api/w/${list.slug}/subscribe`, 'POST', { email: ' Alice@Example.com ' });
  assert.deepEqual([a.status, a.data.position, a.data.already], [200, 1, false]);
  const b = await json(`/api/w/${list.slug}/subscribe`, 'POST', { email: 'bob@example.com' });
  assert.equal(b.data.position, 2);
  const dup = await json(`/api/w/${list.slug}/subscribe`, 'POST', { email: 'alice@example.com' });
  assert.deepEqual([dup.data.position, dup.data.already], [1, true]);
  const bad = await json(`/api/w/${list.slug}/subscribe`, 'POST', { email: 'pas-un-email' });
  assert.equal(bad.status, 400);

  // Formulaire sans JavaScript
  const form = await fetch(`${base}/w/${list.slug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'email=carol%40example.com',
  });
  assert.equal(form.status, 200);
  assert.ok((await form.text()).includes('n°3'));

  const dash = await json(`/api/admin/${list.adminToken}`);
  assert.equal(dash.data.total, 3);
  assert.deepEqual(dash.data.subscribers.map((s) => s.email), ['carol@example.com', 'bob@example.com', 'alice@example.com']);

  const csv = await fetch(`${base}/api/admin/${list.adminToken}/export.csv`).then((r) => r.text());
  assert.match(csv, /1,alice@example.com,/);

  const del = await json(`/api/admin/${list.adminToken}/subscribers/${dash.data.subscribers[1].id}`, 'DELETE');
  assert.equal(del.status, 200);
  assert.equal((await json(`/api/admin/${list.adminToken}`)).data.total, 2);

  const upd = await json(`/api/admin/${list.adminToken}`, 'PATCH', { title: 'Nouveau titre' });
  assert.equal(upd.data.list.title, 'Nouveau titre');

  assert.equal((await json('/api/admin/mauvais-token')).status, 404);
  assert.equal((await json(`/api/admin/${list.adminToken}`, 'DELETE')).status, 200);
  assert.equal((await fetch(`${base}/w/${list.slug}`)).status, 404);
});

test('titre obligatoire', async () => {
  assert.equal((await json('/api/lists', 'POST', { title: '   ' })).status, 400);
});
