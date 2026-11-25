(() => {
  const form = document.querySelector('form.join');
  const success = document.querySelector('.success');
  const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;
  const plural = (n, one, many) => (n <= 1 ? one : many);

  /* ---------- Copier / partager le lien de parrainage (aussi après un envoi sans JS) */
  const refInput = success?.querySelector('[data-ref-url]');
  const copyBtn = success?.querySelector('[data-copy-ref]');
  const shareBtn = success?.querySelector('[data-share]');
  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(refInput.value);
    } catch {
      refInput.select();
      document.execCommand('copy');
    }
    copyBtn.textContent = 'Copié ✓';
    copyBtn.classList.add('copied');
    setTimeout(() => {
      copyBtn.textContent = 'Copier';
      copyBtn.classList.remove('copied');
    }, 1600);
  });
  refInput?.addEventListener('focus', () => refInput.select());
  if (shareBtn && navigator.share) {
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', () => {
      navigator.share({ title: document.title, text: `Rejoignez la liste d’attente « ${document.title} »`, url: refInput.value }).catch(() => {});
    });
  }

  if (!form) return;
  const input = form.querySelector('input[type="email"]');
  const btn = form.querySelector('button[type="submit"]');
  const msg = form.querySelector('.form-msg');

  const setMsg = (text, isError) => {
    msg.textContent = text;
    msg.classList.toggle('error', !!isError);
  };

  const updateCount = (count) => {
    const proof = document.querySelector('.social-proof > span:last-child');
    if (!proof || typeof count !== 'number' || count < 1) return;
    proof.innerHTML = '';
    const strong = document.createElement('strong');
    strong.textContent = count;
    strong.className = 'bump';
    proof.append(strong, ' ', plural(count, 'personne déjà inscrite', 'personnes déjà inscrites'));
  };

  const showRank = (data) => {
    if (typeof data.position !== 'number') return; // réponse sans position (ex. pot de miel)
    success.querySelector('[data-position]').textContent = data.position;
    success.querySelector('[data-total]').textContent = data.total;
    refInput.value = data.refUrl;
    const refs = success.querySelector('[data-referrals]');
    refs.textContent = '';
    if (data.referrals) {
      const b = document.createElement('strong');
      b.textContent = data.referrals;
      refs.append(b, ` ${plural(data.referrals, 'ami parrainé', 'amis parrainés')} 🎉`);
    } else {
      refs.textContent = 'Aucun ami parrainé pour l’instant.';
    }
    success.querySelector('.my-rank').hidden = false;
    success.querySelector('.referral').hidden = false;
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
        body: JSON.stringify({ email, website: form.website.value, ref: form.ref?.value }),
      });
      const data = await res.json();
      if (data.status === 'ok' || data.status === 'already') {
        success.querySelector('[data-success-title]').textContent =
          data.status === 'already' ? 'Vous êtes déjà sur la liste !' : 'Vous êtes sur la liste !';
        const text = success.querySelector('[data-success-text]');
        text.textContent = 'On vous prévient à ';
        const b = document.createElement('strong');
        b.textContent = email.toLowerCase();
        text.append(b, ' dès que c’est prêt.');
        showRank(data);
        document.querySelector('.invited')?.remove();
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
