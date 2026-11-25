// Connexion / inscription.
const form = $('auth-form');
const err = $('auth-error');
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

$('reveal').addEventListener('click', (e) => {
  const shown = form.password.type === 'text';
  form.password.type = shown ? 'password' : 'text';
  e.currentTarget.setAttribute('aria-pressed', String(!shown));
  e.currentTarget.setAttribute('aria-label', shown ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const mode = form.dataset.mode;
  const email = form.email.value.trim();
  const password = form.password.value;
  err.classList.add('hidden');
  if (!EMAIL_RE.test(email)) { showError(err, 'Entrez une adresse email valide.'); form.email.focus(); return; }
  if (mode === 'signup' && password.length < 8) { showError(err, 'Le mot de passe doit faire au moins 8 caractères.'); form.password.focus(); return; }
  if (!password) { showError(err, 'Entrez votre mot de passe.'); form.password.focus(); return; }

  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await api('POST', `/api/auth/${mode}`, { email, password });
    location.href = form.dataset.next || '/app';
  } catch (ex) {
    showError(err, ex.message);
    btn.disabled = false;
  }
});
