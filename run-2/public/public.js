(() => {
  const form = document.querySelector('form.join');
  if (!form) return;
  const input = form.querySelector('input[type="email"]');
  const btn = form.querySelector('button[type="submit"]');
  const msg = form.querySelector('.form-msg');
  const success = document.querySelector('.success');
  const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

  const setMsg = (text, isError) => {
    msg.textContent = text;
    msg.classList.toggle('error', !!isError);
  };

  const updateCount = (count) => {
    const proof = document.querySelector('.social-proof > span:last-child');
    if (!proof || typeof count !== 'number' || count < 1) return;
    const label = count === 1 ? 'personne déjà inscrite' : 'personnes déjà inscrites';
    proof.innerHTML = '';
    const strong = document.createElement('strong');
    strong.textContent = count;
    strong.className = 'bump';
    proof.append(strong, ' ', label);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!EMAIL_RE.test(email)) {
      setMsg('Entrez une adresse email valide.', true);
      input.focus();
      return;
    }
    btn.classList.add('loading');
    btn.disabled = true;
    setMsg('');
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, website: form.website.value }),
      });
      const data = await res.json();
      if (data.status === 'ok' || data.status === 'already') {
        success.querySelector('[data-success-title]').textContent =
          data.status === 'already' ? 'Vous étiez déjà inscrit·e !' : 'Vous êtes sur la liste !';
        const text = success.querySelector('[data-success-text]');
        text.textContent = 'On vous prévient à ';
        const b = document.createElement('strong');
        b.textContent = email.toLowerCase();
        text.append(b, ' dès que c’est prêt.');
        form.hidden = true;
        success.hidden = false;
        updateCount(data.count);
      } else if (data.status === 'invalid') {
        setMsg('Cette adresse email ne semble pas valide.', true);
      } else if (data.status === 'limit') {
        setMsg('Trop de tentatives, réessayez dans une minute.', true);
      } else {
        setMsg('Cette liste n’est plus disponible.', true);
      }
    } catch {
      setMsg('Connexion impossible. Réessayez.', true);
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  });
})();
