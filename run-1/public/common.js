// Petits utilitaires partagés par les pages de l'app.
window.WL = (() => {
  const fmt = new Intl.NumberFormat('fr-FR');

  let toastTimer;
  function toast(message) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  async function copy(text, message = 'Lien copié') {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(message);
  }

  const loginUrl = () => `/login?next=${encodeURIComponent(location.pathname)}`;

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      credentials: 'same-origin',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Session expirée pendant l'utilisation : retour à la connexion.
      if (res.status === 401 && !options.noAuthRedirect) location.href = loginUrl();
      const err = new Error(data.error || 'Une erreur est survenue.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /** Affiche l'utilisateur connecté dans la barre du haut. */
  function showUser(user) {
    const menu = document.querySelector('[data-usermenu]');
    if (!menu || !user) return;
    menu.querySelector('[data-user-email]').textContent = user.email;
    menu.querySelector('[data-user-initial]').textContent = user.email[0];
    menu.hidden = false;
  }

  document.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-logout]')) return;
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    location.href = '/';
  });

  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children.filter((c) => c != null));
    return node;
  };

  return { fmt, toast, copy, api, el, showUser };
})();
