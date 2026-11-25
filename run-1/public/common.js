// Petits utilitaires partagés par l'accueil et le dashboard.
window.WL = (() => {
  const STORE_KEY = 'waitlist:lists';
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

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Une erreur est survenue.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const saved = {
    all() {
      try {
        const list = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
        return Array.isArray(list) ? list.filter((x) => x && typeof x.token === 'string') : [];
      } catch {
        return [];
      }
    },
    add(entry) {
      const rest = saved.all().filter((x) => x.token !== entry.token);
      localStorage.setItem(STORE_KEY, JSON.stringify([entry, ...rest]));
    },
    remove(token) {
      localStorage.setItem(STORE_KEY, JSON.stringify(saved.all().filter((x) => x.token !== token)));
    },
  };

  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children.filter((c) => c != null));
    return node;
  };

  return { fmt, toast, copy, api, saved, el };
})();
