// Utilitaires partagés par les pages connectées.
const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('fr-FR');

// Appel d'API JSON ; une session expirée renvoie vers la connexion.
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    return new Promise(() => {}); // la page se recharge
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Une erreur est survenue.'), { status: res.status });
  return data;
}

function toast(text) {
  const t = $('toast');
  if (!t) return;
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function showError(el, message) {
  el.textContent = message;
  el.classList.remove('hidden');
}

// Menu utilisateur : initiale + déconnexion
for (const el of document.querySelectorAll('[data-initial]')) {
  el.textContent = (el.dataset.initial || '?').charAt(0).toUpperCase();
}
for (const btn of document.querySelectorAll('[data-logout]')) {
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.href = '/login';
  });
}
