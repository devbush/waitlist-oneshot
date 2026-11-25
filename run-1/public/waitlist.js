// Amélioration progressive de la page publique :
// inscription sans rechargement, lien de parrainage, et rang retrouvé au retour sur la page.
(() => {
  const form = document.querySelector('[data-form]');
  const card = document.querySelector('.wl-card');
  if (!form || !card) return;
  const input = form.querySelector('input[name="email"]');
  const button = form.querySelector('button[type="submit"]');
  const errorEl = form.querySelector('[data-error]');
  const success = document.querySelector('[data-success]');
  const invited = document.querySelector('[data-invited]');
  const slug = form.dataset.slug;
  const STORE_KEY = `waitlist:ref:${slug}`;
  const { pageUrl, shareText, title, boost } = card.dataset;
  const fmt = new Intl.NumberFormat('fr-FR');
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const remember = (code) => { try { localStorage.setItem(STORE_KEY, code); } catch {} };
  const recall = () => { try { return localStorage.getItem(STORE_KEY); } catch { return null; } };
  const forget = () => { try { localStorage.removeItem(STORE_KEY); } catch {} };

  // --- Affichage du résultat ------------------------------------------------
  function shareLinks(url) {
    const enc = encodeURIComponent;
    return {
      whatsapp: `https://wa.me/?text=${enc(`${shareText} ${url}`)}`,
      x: `https://twitter.com/intent/tweet?text=${enc(shareText)}&url=${enc(url)}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`,
      email: `mailto:?subject=${enc(`Rejoins la liste d’attente de ${title}`)}&body=${enc(`${shareText}\n${url}`)}`,
    };
  }

  function referralsText(el, n) {
    el.replaceChildren();
    if (n > 0) {
      const strong = document.createElement('strong');
      strong.textContent = fmt.format(n);
      el.append(strong, ` ${n > 1 ? 'personnes se sont inscrites' : 'personne s’est inscrite'} grâce à vous (+${fmt.format(n * boost)} places).`);
    } else {
      el.textContent = 'Personne ne s’est encore inscrit avec votre lien.';
    }
  }

  function showSuccess(data, { returning = false } = {}) {
    const url = `${pageUrl}?ref=${data.refCode}`;
    success.querySelector('[data-position]').textContent = `n°${fmt.format(data.position)}`;
    success.querySelector('[data-success-title]').textContent =
      returning ? 'Content de vous revoir !' : data.already ? 'Vous êtes déjà inscrit·e' : 'C’est noté !';
    success.querySelector('[data-share-url]').value = url;
    const links = shareLinks(url);
    success.querySelectorAll('[data-share]').forEach((a) => (a.href = links[a.dataset.share]));
    referralsText(success.querySelector('[data-referrals]'), data.referrals);
    success.querySelector('[data-not-me]').hidden = false;
    if (data.total) updateProof(data.total);
    form.hidden = true;
    if (invited) invited.hidden = true;
    success.hidden = false;
  }

  function updateProof(total) {
    const proof = document.querySelector('[data-proof]');
    const strong = document.createElement('strong');
    strong.textContent = fmt.format(total);
    proof.replaceChildren(strong, ` ${total > 1 ? 'personnes ont' : 'personne a'} déjà rejoint la liste`);
  }

  // --- Partage --------------------------------------------------------------
  const copyBtn = success.querySelector('[data-copy-share]');
  copyBtn.addEventListener('click', async () => {
    const field = success.querySelector('[data-share-url]');
    try {
      await navigator.clipboard.writeText(field.value);
    } catch {
      field.select();
      document.execCommand('copy');
    }
    copyBtn.textContent = 'Copié ✓';
    setTimeout(() => (copyBtn.textContent = 'Copier'), 1800);
  });
  success.querySelector('[data-share-url]').addEventListener('focus', (e) => e.target.select());

  const nativeBtn = success.querySelector('[data-share-native]');
  if (navigator.share) {
    nativeBtn.hidden = false;
    nativeBtn.addEventListener('click', () => {
      navigator.share({ title, text: shareText, url: success.querySelector('[data-share-url]').value }).catch(() => {});
    });
  }

  success.querySelector('[data-not-me]').addEventListener('click', () => {
    forget();
    success.hidden = true;
    form.hidden = false;
    if (invited) invited.hidden = false;
    input.value = '';
    input.focus();
  });

  // Page rendue par le serveur après un envoi sans JavaScript : on mémorise le code.
  if (!success.hidden) {
    const code = new URL(success.querySelector('[data-share-url]').value, location.href).searchParams.get('ref');
    if (code) remember(code);
    success.querySelector('[data-not-me]').hidden = false;
  }

  // --- Retour sur la page : on retrouve son rang ------------------------------
  const saved = recall();
  if (saved && success.hidden) {
    fetch(`/api/w/${slug}/status/${encodeURIComponent(saved)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data) => showSuccess(data, { returning: true }))
      .catch((status) => { if (status === 404) forget(); });
  }

  // --- Inscription ----------------------------------------------------------
  const showError = (msg) => {
    errorEl.textContent = msg;
    input.setAttribute('aria-invalid', 'true');
    form.classList.remove('shake');
    void form.offsetWidth; // relance l'animation
    form.classList.add('shake');
    input.focus();
  };

  input.addEventListener('input', () => {
    errorEl.textContent = '';
    input.removeAttribute('aria-invalid');
    form.classList.remove('shake');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!EMAIL_RE.test(email)) return showError('Entrez une adresse email valide.');

    button.disabled = true;
    form.classList.add('is-loading');
    try {
      const res = await fetch(`/api/w/${slug}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, ref: form.elements.ref?.value || '', website: form.elements.website?.value || '' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Une erreur est survenue. Réessayez.');
      remember(data.refCode);
      showSuccess(data);
    } catch (err) {
      showError(err.message === 'Failed to fetch' ? 'Connexion impossible. Vérifiez votre réseau.' : err.message);
    } finally {
      button.disabled = false;
      form.classList.remove('is-loading');
    }
  });
})();
