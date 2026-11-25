// Page publique : inscription à la liste d'attente.
const form = document.getElementById('join-form');
const msg = document.getElementById('join-msg');
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = form.querySelector('button');
  const email = form.email.value.trim();
  msg.textContent = '';
  if (!EMAIL_RE.test(email)) {
    msg.textContent = 'Entrez une adresse email valide.';
    form.email.focus();
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Inscription…';
  try {
    const res = await fetch(`/api/w/${encodeURIComponent(form.dataset.slug)}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, website: form.website.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Une erreur est survenue.');

    if (data.already) {
      document.getElementById('success-title').textContent = 'Vous êtes déjà inscrit·e !';
      document.getElementById('success-text').textContent = 'Pas besoin de vous réinscrire, votre place est gardée au chaud.';
    }
    if (data.position) {
      document.getElementById('position-n').textContent = `#${data.position.toLocaleString('fr-FR')}`;
      document.getElementById('position').classList.remove('hidden');
    }
    document.getElementById('join-view').classList.add('hidden');
    document.getElementById('success-view').classList.remove('hidden');
  } catch (ex) {
    msg.textContent = ex.message;
    btn.disabled = false;
    btn.textContent = 'Rejoindre la liste';
  }
});
