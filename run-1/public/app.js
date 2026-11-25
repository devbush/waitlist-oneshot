(() => {
  const { api, copy, el, fmt, showUser, renderPlan, toast } = window.WL;
  const $ = (id) => document.getElementById(id);
  const form = $('create-form');
  const created = $('created');
  const builder = $('builder');
  const errorEl = $('create-error');
  const titleInput = form.elements.title;
  const descInput = form.elements.description;
  let lists = [];

  const slugify = (s) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'mon-projet';

  // --- Mes listes -----------------------------------------------------------
  function renderLists() {
    const hasLists = lists.length > 0;
    $('mylists').hidden = !hasLists;
    $('first-hero').hidden = hasLists;
    $('cancel-create').hidden = !hasLists;
    if (!hasLists) builder.hidden = false;

    const total = lists.reduce((a, l) => a + l.total, 0);
    $('mylists-sub').textContent =
      `${lists.length} ${lists.length > 1 ? 'listes' : 'liste'} · ${fmt.format(total)} ${total > 1 ? 'inscrits' : 'inscrit'} au total`;
    $('mylists-grid').replaceChildren(
      ...lists.map((l) =>
        el('a', { className: 'card list-tile', href: `/app/lists/${l.slug}` },
          el('div', {},
            el('h3', { textContent: l.title }),
            el('span', { className: 'slug', textContent: `/w/${l.slug}` })),
          el('div', { className: 'meta' },
            el('span', {},
              el('span', { className: 'num', textContent: fmt.format(l.total) }),
              ` ${l.total > 1 ? 'inscrits' : 'inscrit'}`),
            el('span', {
              className: l.week ? 'week up' : 'week',
              textContent: l.week ? `+${fmt.format(l.week)} cette semaine` : 'rien cette semaine',
            }))
        )
      )
    );
  }

  async function loadLists() {
    try {
      const data = await api('/api/lists');
      showUser(data.user);
      lists = data.lists;
      $('state').hidden = true;
      renderLists();
      renderPlan($('plan'), data.plan, { activating: activating && data.plan.plan !== 'pro' });
      return data;
    } catch (err) {
      if (err.status !== 401) $('state').replaceChildren(el('p', { textContent: err.message }));
    }
  }

  // --- Retour depuis Stripe Checkout ----------------------------------------
  // Le plan passe en Pro quand le webhook Stripe arrive : on attend quelques secondes.
  const billing = new URLSearchParams(location.search).get('billing');
  let activating = billing === 'success';
  if (billing) history.replaceState(null, '', '/app');
  if (billing === 'cancel') toast('Paiement annulé : vous êtes toujours sur le plan gratuit.');

  async function waitForPro(attempt = 0) {
    const data = await loadLists();
    if (data?.plan.plan === 'pro') {
      activating = false;
      toast('Merci ! Votre plan Pro est actif.');
      return;
    }
    if (attempt < 15) return setTimeout(() => waitForPro(attempt + 1), 2000);
    activating = false;
    loadLists();
    toast('Le paiement est bien reçu, mais l’activation prend plus de temps que prévu. Rechargez la page dans une minute.');
  }

  function openBuilder() {
    form.reset();
    renderPreview();
    created.hidden = true;
    form.hidden = false;
    builder.hidden = false;
    builder.scrollIntoView({ behavior: 'smooth', block: 'start' });
    titleInput.focus({ preventScroll: true });
  }

  $('new-list').addEventListener('click', openBuilder);
  $('create-another').addEventListener('click', openBuilder);
  $('cancel-create').addEventListener('click', () => (builder.hidden = true));

  // --- Aperçu en direct -----------------------------------------------------
  function renderPreview() {
    const title = titleInput.value.trim();
    const desc = descInput.value.trim();
    $('preview-title').textContent = title || 'Mon super projet';
    $('preview-desc').replaceChildren(
      ...(desc
        ? desc.split(/\n{2,}/).map((p) => {
            const node = el('p');
            p.split('\n').forEach((line, i) => {
              if (i) node.append(el('br'));
              node.append(line);
            });
            return node;
          })
        : [el('p', { className: 'placeholder', textContent: 'Votre description apparaîtra ici.' })])
    );
    $('preview-url').textContent = `${location.host}/w/${slugify(title)}`;
    for (const input of [titleInput, descInput]) {
      document.querySelector(`[data-counter="${input.name}"]`).textContent = `${input.value.length}/${input.maxLength}`;
    }
  }
  form.addEventListener('input', () => {
    errorEl.textContent = '';
    renderPreview();
  });
  renderPreview();

  // --- Création -------------------------------------------------------------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) {
      errorEl.textContent = 'Donnez un nom à votre projet.';
      titleInput.focus();
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    form.classList.add('is-loading');
    try {
      const data = await api('/api/lists', { method: 'POST', body: { title, description: descInput.value } });
      const publicUrl = `${location.origin}/w/${data.slug}`;
      $('public-url').value = publicUrl;
      $('open-public').href = publicUrl;
      $('open-admin').href = `/app/lists/${data.slug}`;
      form.hidden = true;
      created.hidden = false;
      loadLists();
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      button.disabled = false;
      form.classList.remove('is-loading');
    }
  });

  $('copy-public').addEventListener('click', () => copy($('public-url').value));

  if (activating) waitForPro();
  else loadLists();
})();
