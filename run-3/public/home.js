// Accueil : création d'une liste + listes mémorisées sur cet appareil.
const STORE_KEY = 'waitlist:lists';

function savedLists() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
}

function renderSaved() {
  const lists = savedLists();
  const section = document.getElementById('my-lists');
  const grid = document.getElementById('lists-grid');
  section.classList.toggle('hidden', lists.length === 0);
  grid.replaceChildren(...lists.map((l) => {
    const a = document.createElement('a');
    a.className = 'card list-tile';
    a.href = `/d/${encodeURIComponent(l.token)}`;
    const h = document.createElement('h3'); h.textContent = l.title;
    const p = document.createElement('p'); p.textContent = `Créée le ${new Date(l.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    const o = document.createElement('div'); o.className = 'open'; o.textContent = 'Ouvrir le dashboard →';
    a.append(h, p, o);
    return a;
  }));
}

document.getElementById('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = form.querySelector('button');
  const err = document.getElementById('create-error');
  const title = form.title.value.trim();
  err.classList.add('hidden');
  if (!title) {
    err.textContent = 'Donnez un nom à votre projet.';
    err.classList.remove('hidden');
    form.title.focus();
    return;
  }
  btn.disabled = true;
  try {
    const res = await fetch('/api/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description: form.description.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Une erreur est survenue.');
    const lists = savedLists().filter((l) => l.token !== data.token);
    lists.unshift({ token: data.token, slug: data.slug, title, createdAt: new Date().toISOString() });
    localStorage.setItem(STORE_KEY, JSON.stringify(lists));
    location.href = `/d/${encodeURIComponent(data.token)}?new=1`;
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
    btn.disabled = false;
  }
});

renderSaved();
