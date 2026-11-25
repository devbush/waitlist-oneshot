(() => {
  const { api, copy, saved, el, fmt } = window.WL;
  const form = document.getElementById('create-form');
  const created = document.getElementById('created');
  const errorEl = document.getElementById('create-error');
  const titleInput = form.elements.title;
  const descInput = form.elements.description;
  const previewTitle = document.getElementById('preview-title');
  const previewDesc = document.getElementById('preview-desc');
  const previewUrl = document.getElementById('preview-url');

  const slugify = (s) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'mon-projet';

  // --- Aperçu en direct -----------------------------------------------------
  function renderPreview() {
    const title = titleInput.value.trim();
    const desc = descInput.value.trim();
    previewTitle.textContent = title || 'Mon super projet';
    previewDesc.replaceChildren(
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
    previewUrl.textContent = `${location.host}/w/${slugify(title)}`;
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
      saved.add({ token: data.adminToken, slug: data.slug, title: data.title });
      const publicUrl = `${location.origin}/w/${data.slug}`;
      const adminUrl = `${location.origin}/admin/${data.adminToken}`;
      document.getElementById('public-url').value = publicUrl;
      document.getElementById('admin-url').value = adminUrl;
      document.getElementById('open-public').href = publicUrl;
      document.getElementById('open-admin').href = adminUrl;
      form.hidden = true;
      created.hidden = false;
      loadMyLists();
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      button.disabled = false;
      form.classList.remove('is-loading');
    }
  });

  document.querySelectorAll('[data-copy]').forEach((btn) =>
    btn.addEventListener('click', () => copy(document.getElementById(btn.dataset.copy).value))
  );

  document.getElementById('create-another').addEventListener('click', () => {
    form.reset();
    renderPreview();
    created.hidden = true;
    form.hidden = false;
    titleInput.focus();
  });

  // --- Mes listes -----------------------------------------------------------
  async function loadMyLists() {
    const tokens = saved.all().map((x) => x.token);
    const section = document.getElementById('mylists');
    if (!tokens.length) return (section.hidden = true);
    try {
      const { lists } = await api('/api/lists/summary', { method: 'POST', body: { tokens } });
      // Oublie les listes supprimées entre-temps.
      const alive = new Set(lists.map((l) => l.token));
      tokens.filter((t) => !alive.has(t)).forEach((t) => saved.remove(t));
      section.hidden = lists.length === 0;
      document.getElementById('mylists-grid').replaceChildren(
        ...lists.map((l) =>
          el('a', { className: 'card list-tile', href: `/admin/${l.token}` },
            el('h3', { textContent: l.title }),
            el('div', { className: 'meta' },
              el('span', { className: 'num', textContent: fmt.format(l.total) }),
              el('span', { textContent: l.total > 1 ? 'inscrits' : 'inscrit' })
            )
          )
        )
      );
    } catch {
      section.hidden = true;
    }
  }
  loadMyLists();
})();
