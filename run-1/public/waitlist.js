// Amélioration progressive de la page publique : inscription sans rechargement.
(() => {
  const form = document.querySelector('[data-form]');
  if (!form) return;
  const input = form.querySelector('input[name="email"]');
  const button = form.querySelector('button[type="submit"]');
  const errorEl = form.querySelector('[data-error]');
  const success = document.querySelector('[data-success]');
  const fmt = new Intl.NumberFormat('fr-FR');
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
      const res = await fetch(`/api/w/${form.dataset.slug}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, website: form.elements.website?.value || '' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Une erreur est survenue. Réessayez.');

      success.querySelector('[data-position]').textContent = `n°${fmt.format(data.position)}`;
      success.querySelector('[data-success-title]').textContent = data.already ? 'Vous êtes déjà inscrit·e' : 'C’est noté !';
      if (data.total) {
        const proof = document.querySelector('[data-proof]');
        proof.innerHTML = '';
        const strong = document.createElement('strong');
        strong.textContent = fmt.format(data.total);
        proof.append(strong, ` ${data.total > 1 ? 'personnes ont' : 'personne a'} déjà rejoint la liste`);
      }
      form.hidden = true;
      success.hidden = false;
    } catch (err) {
      showError(err.message === 'Failed to fetch' ? 'Connexion impossible. Vérifiez votre réseau.' : err.message);
    } finally {
      button.disabled = false;
      form.classList.remove('is-loading');
    }
  });
})();
