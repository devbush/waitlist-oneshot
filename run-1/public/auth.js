(() => {
  const { api, el } = window.WL;
  const $ = (id) => document.getElementById(id);
  const isSignup = location.pathname === '/signup';
  const params = new URLSearchParams(location.search);
  const rawNext = params.get('next') || '';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.startsWith('/\\') ? rawNext : '/app';
  const nextQuery = rawNext ? `?next=${encodeURIComponent(next)}` : '';

  const form = $('auth-form');
  const errorEl = $('auth-error');
  const password = $('password');

  if (isSignup) {
    document.title = 'Créer un compte — Waitlist';
    $('auth-title').textContent = 'Créez votre compte';
    $('auth-sub').textContent = 'Gratuit. Lancez votre première liste d’attente en moins d’une minute.';
    $('auth-submit').textContent = 'Créer mon compte';
    password.autocomplete = 'new-password';
    $('password-hint').hidden = false;
  }
  $('auth-switch').append(
    isSignup ? 'Déjà un compte ? ' : 'Pas encore de compte ? ',
    el('a', { href: `${isSignup ? '/login' : '/signup'}${nextQuery}`, textContent: isSignup ? 'Se connecter' : 'Créer un compte' })
  );
  $('email').focus();

  $('toggle-password').addEventListener('click', (e) => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'Masquer' : 'Afficher';
    e.currentTarget.setAttribute('aria-pressed', String(show));
  });

  form.addEventListener('input', () => (errorEl.textContent = ''));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      errorEl.textContent = 'Entrez une adresse email valide.';
      return $('email').focus();
    }
    if (isSignup && password.value.length < 8) {
      errorEl.textContent = 'Le mot de passe doit faire au moins 8 caractères.';
      return password.focus();
    }
    if (!password.value) {
      errorEl.textContent = 'Entrez votre mot de passe.';
      return password.focus();
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    form.classList.add('is-loading');
    try {
      await api(isSignup ? '/api/auth/signup' : '/api/auth/login', {
        method: 'POST',
        body: { email, password: password.value },
        noAuthRedirect: true,
      });
      location.href = next;
    } catch (err) {
      errorEl.textContent = err.message;
      if (err.status === 401) password.select();
      button.disabled = false;
      form.classList.remove('is-loading');
    }
  });
})();
