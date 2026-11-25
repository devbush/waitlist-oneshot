import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { server } = await import('../server.js');
let base;

before(() => new Promise((r) => server.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); })));
after(() => new Promise((r) => { server.closeAllConnections(); server.close(r); }));

/** Petit client HTTP qui garde son cookie de session, comme un navigateur. */
function client() {
  let cookie = '';
  const request = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body && JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : await res.text() };
  };
  return { request, get cookie() { return cookie; } };
}

let n = 0;
async function newUser() {
  const c = client();
  const email = `user${++n}@test.fr`;
  const res = await c.request('/api/auth/signup', { method: 'POST', body: { email, password: 'motdepasse123' } });
  assert.equal(res.status, 201);
  return Object.assign(c, { email });
}

test('inscription, connexion et déconnexion', async () => {
  const c = client();
  assert.equal((await c.request('/api/auth/signup', { method: 'POST', body: { email: 'a@test.fr', password: 'court' } })).status, 400);
  const signup = await c.request('/api/auth/signup', { method: 'POST', body: { email: ' A@Test.fr ', password: 'motdepasse123' } });
  assert.equal(signup.status, 201);
  assert.match(signup.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  assert.equal((await c.request('/api/auth/me')).data.user.email, 'a@test.fr');

  const again = await client().request('/api/auth/signup', { method: 'POST', body: { email: 'a@test.fr', password: 'autremotdepasse' } });
  assert.equal(again.status, 409);

  await c.request('/api/auth/logout', { method: 'POST' });
  assert.equal((await c.request('/api/auth/me')).data.user, null);

  assert.equal((await c.request('/api/auth/login', { method: 'POST', body: { email: 'a@test.fr', password: 'mauvais-mdp' } })).status, 401);
  assert.equal((await c.request('/api/auth/login', { method: 'POST', body: { email: 'inconnu@test.fr', password: 'motdepasse123' } })).status, 401);
  assert.equal((await c.request('/api/auth/login', { method: 'POST', body: { email: 'A@test.fr', password: 'motdepasse123' } })).status, 200);
  assert.equal((await c.request('/api/auth/me')).data.user.email, 'a@test.fr');
});

test('les pages privées redirigent vers la connexion', async () => {
  const anon = client();
  const app = await anon.request('/app');
  assert.equal(app.status, 302);
  assert.equal(app.headers.get('location'), '/login?next=/app');
  assert.equal((await anon.request('/api/lists')).status, 401);
  assert.equal((await anon.request('/api/lists', { method: 'POST', body: { title: 'X' } })).status, 401);

  const user = await newUser();
  assert.equal((await user.request('/')).headers.get('location'), '/app');
  assert.equal((await user.request('/app')).status, 200);
  assert.equal((await user.request('/login?next=//evil.com')).headers.get('location'), '/app');
});

test('chacun ne voit que ses listes', async () => {
  const alice = await newUser();
  const bob = await newUser();
  const { data: list } = await alice.request('/api/lists', { method: 'POST', body: { title: 'Projet d’Alice' } });

  assert.deepEqual((await alice.request('/api/lists')).data.lists.map((l) => l.title), ['Projet d’Alice']);
  assert.deepEqual((await bob.request('/api/lists')).data.lists, []);

  // Bob ne peut ni lire, ni modifier, ni vider, ni exporter, ni supprimer la liste d'Alice.
  const path = `/api/lists/${list.slug}`;
  assert.equal((await bob.request(path)).status, 404);
  assert.equal((await bob.request(path, { method: 'PATCH', body: { title: 'Piraté' } })).status, 404);
  assert.equal((await bob.request(`${path}/export.csv`)).status, 404);
  assert.equal((await bob.request(`${path}/subscribers/1`, { method: 'DELETE' })).status, 404);
  assert.equal((await bob.request(path, { method: 'DELETE' })).status, 404);
  assert.equal((await bob.request(`/app/lists/${list.slug}`)).status, 404);

  assert.equal((await alice.request(path)).data.list.title, 'Projet d’Alice');
  assert.equal((await alice.request(`/app/lists/${list.slug}`)).status, 200);
});

test('parcours complet : inscriptions, dashboard, export, suppression', async () => {
  const owner = await newUser();
  const visitor = client();
  const { status, data: list } = await owner.request('/api/lists', {
    method: 'POST',
    body: { title: 'Mon Projet Génial <b>', description: 'Ligne 1\n\nLigne 2' },
  });
  assert.equal(status, 201);
  assert.match(list.slug, /^mon-projet-genial-b-[0-9a-f]{6}$/);

  const page = await visitor.request(`/w/${list.slug}`);
  assert.ok(page.data.includes('Mon Projet Génial &lt;b&gt;'), 'titre échappé');
  assert.ok(!page.data.includes('Génial <b>'));

  const sub = (email) => visitor.request(`/api/w/${list.slug}/subscribe`, { method: 'POST', body: { email } });
  const a = await sub(' Alice@Example.com ');
  assert.deepEqual([a.status, a.data.position, a.data.already], [200, 1, false]);
  assert.equal((await sub('bob@example.com')).data.position, 2);
  const dup = await sub('alice@example.com');
  assert.deepEqual([dup.data.position, dup.data.already], [1, true]);
  assert.equal((await sub('pas-un-email')).status, 400);

  // Formulaire sans JavaScript
  const form = await fetch(`${base}/w/${list.slug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'email=carol%40example.com',
  });
  assert.equal(form.status, 200);
  assert.ok((await form.text()).includes('n°3'));

  const path = `/api/lists/${list.slug}`;
  const dash = await owner.request(path);
  assert.equal(dash.data.total, 3);
  assert.deepEqual(dash.data.subscribers.map((s) => s.email), ['carol@example.com', 'bob@example.com', 'alice@example.com']);
  assert.equal((await owner.request('/api/lists')).data.lists[0].total, 3);

  const csv = await owner.request(`${path}/export.csv`);
  assert.match(csv.data, /1,alice@example.com,/);

  assert.equal((await owner.request(`${path}/subscribers/${dash.data.subscribers[1].id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await owner.request(path)).data.total, 2);

  assert.equal((await owner.request(path, { method: 'PATCH', body: { title: 'Nouveau titre' } })).data.list.title, 'Nouveau titre');
  assert.equal((await owner.request(path, { method: 'DELETE' })).status, 200);
  assert.equal((await visitor.request(`/w/${list.slug}`)).status, 404);
});

test('les requêtes venant d’un autre site sont refusées', async () => {
  const user = await newUser();
  const res = await user.request('/api/lists', { method: 'POST', body: { title: 'X' }, headers: { Origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
  assert.deepEqual((await user.request('/api/lists')).data.lists, []);
});

test('titre obligatoire', async () => {
  const user = await newUser();
  assert.equal((await user.request('/api/lists', { method: 'POST', body: { title: '   ' } })).status, 400);
});
