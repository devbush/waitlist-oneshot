(() => {
  const { api, copy, saved, el, fmt, toast } = window.WL;
  const token = decodeURIComponent(location.pathname.split('/')[2] || '');
  const $ = (id) => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';
  const PAGE = 25;
  const DAY = 86_400_000;

  const state = { data: null, range: 30, query: '', shown: PAGE, signature: '', seenIds: null, newIds: new Set() };

  // --- Dates ----------------------------------------------------------------
  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const fmtShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
  const fmtLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' });
  const fmtFull = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const rtf = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });

  function relative(ts) {
    const s = Math.round((ts - Date.now()) / 1000);
    const abs = Math.abs(s);
    if (abs < 45) return 'à l’instant';
    if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
    return null;
  }

  const plural = (n, one, many) => `${fmt.format(n)} ${n > 1 ? many : one}`;

  // --- Agrégats -------------------------------------------------------------
  function dailyCounts(subs, days) {
    const today = startOfDay(new Date());
    const buckets = [];
    const index = new Map();
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      index.set(dayKey(date), buckets.length);
      buckets.push({ date, count: 0 });
    }
    for (const s of subs) {
      const i = index.get(dayKey(new Date(s.createdAt)));
      if (i !== undefined) buckets[i].count += 1;
    }
    return buckets;
  }

  function renderKpis(data) {
    const subs = data.subscribers;
    const now = new Date();
    const today = startOfDay(now).getTime();
    const yesterday = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)).getTime();
    const weekStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)).getTime();
    const prevWeekStart = weekStart - 7 * DAY;

    let nToday = 0, nYesterday = 0, nWeek = 0, nPrevWeek = 0;
    for (const s of subs) {
      if (s.createdAt >= today) nToday++;
      else if (s.createdAt >= yesterday) nYesterday++;
      if (s.createdAt >= weekStart) nWeek++;
      else if (s.createdAt >= prevWeekStart) nPrevWeek++;
    }

    $('kpi-total').textContent = fmt.format(data.total);
    $('kpi-since').textContent = `depuis le ${fmtDate.format(new Date(data.list.createdAt))}`;
    $('kpi-today').textContent = fmt.format(nToday);
    $('kpi-today-foot').textContent = `hier : ${fmt.format(nYesterday)}`;
    $('kpi-week').textContent = fmt.format(nWeek);

    const foot = $('kpi-week-foot');
    const diff = nWeek - nPrevWeek;
    let cls = 'flat', label = '= stable';
    if (diff !== 0) {
      cls = diff > 0 ? 'up' : 'down';
      const arrow = diff > 0 ? '▲' : '▼';
      label = nPrevWeek > 0
        ? `${arrow} ${diff > 0 ? '+' : '−'}${fmt.format(Math.round((Math.abs(diff) / nPrevWeek) * 100))} %`
        : `${arrow} +${fmt.format(diff)}`;
    }
    foot.replaceChildren(el('span', { className: `delta ${cls}`, textContent: label }), ' vs 7 jours précédents');
  }

  // --- Graphique ------------------------------------------------------------
  function niceScale(max) {
    if (max <= 4) return { max: 4, step: 1 };
    const raw = max / 4;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
    return { max: Math.ceil(max / step) * step, step };
  }

  const svgEl = (tag, attrs = {}) => {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };

  function barPath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    const y0 = y + h;
    return `M${x},${y0}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y0}Z`;
  }

  function renderChart() {
    if (!state.data) return;
    const container = $('chart');
    const buckets = dailyCounts(state.data.subscribers, state.range);
    const totalInRange = buckets.reduce((a, b) => a + b.count, 0);
    $('chart-sub').textContent = `${plural(totalInRange, 'inscription', 'inscriptions')} sur les ${state.range} derniers jours`;
    container.setAttribute('aria-label', `Graphique en barres : ${plural(totalInRange, 'inscription', 'inscriptions')} sur les ${state.range} derniers jours`);

    // Vue tableau pour les lecteurs d'écran.
    $('chart-table').tBodies[0].replaceChildren(
      ...buckets.map((b) => el('tr', {}, el('td', { textContent: fmtLong.format(b.date) }), el('td', { textContent: String(b.count) })))
    );

    const W = container.clientWidth || 600;
    const H = container.clientHeight || 240;
    const m = { top: 12, right: 4, bottom: 26, left: 34 };
    const pw = W - m.left - m.right;
    const ph = H - m.top - m.bottom;
    const { max, step } = niceScale(Math.max(...buckets.map((b) => b.count)));
    const yOf = (v) => m.top + ph - (v / max) * ph;
    const band = pw / buckets.length;
    const gap = Math.max(2, Math.min(band * 0.28, 10));
    const bw = Math.max(1, band - gap);

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' });

    const grid = svgEl('g', { class: 'grid' });
    const yAxis = svgEl('g', { class: 'axis' });
    for (let v = 0; v <= max + 1e-9; v += step) {
      const y = Math.round(yOf(v)) + 0.5;
      if (v > 0) grid.append(svgEl('line', { x1: m.left, x2: W - m.right, y1: y, y2: y }));
      const t = svgEl('text', { x: m.left - 10, y: y + 4, 'text-anchor': 'end' });
      t.textContent = fmt.format(v);
      yAxis.append(t);
    }
    svg.append(grid, yAxis);

    const bars = svgEl('g');
    const hits = svgEl('g');
    const xAxis = svgEl('g', { class: 'axis' });
    const every = Math.max(1, Math.ceil(buckets.length / Math.max(2, Math.floor(pw / 70))));

    buckets.forEach((b, i) => {
      const x = m.left + i * band + gap / 2;
      let bar = null;
      if (b.count > 0) {
        const y = yOf(b.count);
        bar = svgEl('path', { class: 'bar', d: barPath(x, y, bw, m.top + ph - y, 4) });
        bars.append(bar);
      }
      const hit = svgEl('rect', { class: 'hit', x: m.left + i * band, y: m.top, width: band, height: ph });
      hit.addEventListener('pointerenter', () => showTip(b, bar, m.left + i * band + band / 2, b.count ? yOf(b.count) : m.top + ph));
      hits.append(hit);

      if ((buckets.length - 1 - i) % every === 0) {
        const cx = m.left + i * band + band / 2;
        const anchor = i === buckets.length - 1 && cx > W - 30 ? 'end' : 'middle';
        const t = svgEl('text', { x: anchor === 'end' ? W - m.right : cx, y: H - 6, 'text-anchor': anchor });
        t.textContent = i === buckets.length - 1 ? 'Auj.' : fmtShort.format(b.date);
        xAxis.append(t);
      }
    });
    svg.append(svgEl('line', { class: 'baseline', x1: m.left, x2: W - m.right, y1: m.top + ph + 0.5, y2: m.top + ph + 0.5 }), bars, xAxis, hits);

    const tip = el('div', { className: 'tooltip' });
    tip.hidden = true;
    function showTip(b, bar, x, y) {
      container.classList.add('hovering');
      bars.querySelectorAll('.active').forEach((n) => n.classList.remove('active'));
      if (bar) bar.classList.add('active');
      tip.replaceChildren(
        el('strong', { textContent: plural(b.count, 'inscription', 'inscriptions') }),
        el('span', { textContent: fmtLong.format(b.date) })
      );
      tip.hidden = false;
      const half = tip.offsetWidth / 2;
      tip.style.left = `${Math.min(Math.max(x, half), W - half)}px`;
      tip.style.top = `${y}px`;
    }
    hits.addEventListener('pointerleave', () => {
      container.classList.remove('hovering');
      tip.hidden = true;
    });

    const children = [svg, tip];
    if (totalInRange === 0) children.push(el('div', { className: 'chart-empty', textContent: 'Aucune inscription sur cette période' }));
    container.replaceChildren(...children);
  }

  // --- Tableau des inscrits -------------------------------------------------
  const AV_COLORS = ['#6a4ce2', '#d9488b', '#0f8a6c', '#c2580c', '#2563eb', '#7c3aed', '#b45309', '#0e7490'];
  const avatarColor = (s) => AV_COLORS[[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AV_COLORS.length];

  const ICON_TRASH = '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';

  function renderRows() {
    const { subscribers, total } = state.data;
    const q = state.query.trim().toLowerCase();
    const filtered = q ? subscribers.filter((s) => s.email.includes(q)) : subscribers;
    const visible = filtered.slice(0, state.shown);

    $('list-sub').textContent = q
      ? `${plural(filtered.length, 'résultat', 'résultats')} sur ${fmt.format(total)}`
      : `${plural(total, 'personne inscrite', 'personnes inscrites')}, du plus récent au plus ancien`;

    $('rows').replaceChildren(
      ...visible.map((s) => {
        const rel = relative(s.createdAt);
        const del = el('button', { className: 'btn btn-ghost btn-sm btn-icon', type: 'button', title: 'Retirer de la liste', innerHTML: ICON_TRASH });
        del.setAttribute('aria-label', `Retirer ${s.email}`);
        del.addEventListener('click', () => removeSubscriber(s));
        const av = el('span', { className: 'av', textContent: s.email[0] });
        av.style.background = avatarColor(s.email);
        return el('tr', { className: state.newIds.has(s.id) ? 'is-new' : '' },
          el('td', { className: 'num', textContent: fmt.format(s.position) }),
          el('td', { className: 'email' }, av, s.email),
          el('td', { className: 'date', title: fmtFull.format(new Date(s.createdAt)) },
            fmtFull.format(new Date(s.createdAt)),
            rel ? el('span', { className: 'rel muted', textContent: ` · ${rel}` }) : null),
          el('td', { className: 'act' }, del)
        );
      })
    );

    const empty = $('empty');
    empty.hidden = filtered.length > 0;
    if (!filtered.length) {
      empty.replaceChildren(
        el('div', { className: 'ico', innerHTML: q
          ? '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>'
          : '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>' }),
        el('strong', { textContent: q ? 'Aucun résultat' : 'Pas encore d’inscrits' }),
        el('span', { textContent: q ? `Aucun email ne contient « ${state.query.trim()} ».` : 'Partagez votre page publique pour recevoir vos premières inscriptions.' })
      );
      if (!q) {
        const share = el('button', { className: 'btn btn-primary btn-sm', type: 'button', textContent: 'Copier le lien public' });
        share.addEventListener('click', copyPublic);
        empty.append(share);
      }
    }
    $('more').hidden = filtered.length <= state.shown;
  }

  // --- Chargement & actions -------------------------------------------------
  const publicUrl = () => `${location.origin}/w/${state.data.list.slug}`;
  const copyPublic = () => copy(publicUrl(), 'Lien public copié');

  function render(first) {
    const { list } = state.data;
    document.title = `${list.title} — Dashboard`;
    $('title').textContent = list.title;
    $('crumb-title').textContent = list.title;
    const link = $('public-link');
    link.href = publicUrl();
    link.textContent = `${location.host}/w/${list.slug}`;
    $('open-public').href = publicUrl();
    $('export').href = `/api/admin/${encodeURIComponent(token)}/export.csv`;
    if (first) {
      $('edit-title').value = list.title;
      $('edit-desc').value = list.description;
    }
    renderKpis(state.data);
    renderChart();
    renderRows();
  }

  async function load({ first = false } = {}) {
    try {
      const data = await api(`/api/admin/${encodeURIComponent(token)}`);
      const signature = `${data.total}:${data.subscribers[0]?.id}:${data.list.title}:${data.list.description}`;
      if (!first && signature === state.signature) return;
      const ids = new Set(data.subscribers.map((s) => s.id));
      state.newIds = state.seenIds ? new Set([...ids].filter((id) => !state.seenIds.has(id))) : new Set();
      if (state.newIds.size) toast(state.newIds.size > 1 ? `${state.newIds.size} nouveaux inscrits` : 'Nouvel inscrit !');
      state.seenIds = ids;
      state.signature = signature;
      state.data = data;
      if (first) {
        saved.add({ token, slug: data.list.slug, title: data.list.title });
        $('state').hidden = true;
        $('dash').hidden = false;
      }
      render(first);
      if (state.newIds.size) setTimeout(() => state.newIds.clear(), 2500);
    } catch (err) {
      if (!first) return; // erreur réseau passagère pendant l'actualisation
      $('state').replaceChildren(
        el('div', { className: 'empty' },
          el('strong', { textContent: err.status === 404 ? 'Liste introuvable' : 'Impossible de charger le dashboard' }),
          el('span', { textContent: err.status === 404 ? 'Ce lien n’est pas valide ou la liste a été supprimée.' : err.message }),
          el('a', { className: 'btn btn-primary', href: '/', textContent: 'Retour à l’accueil' }))
      );
      if (err.status === 404) saved.remove(token);
    }
  }

  async function removeSubscriber(s) {
    if (!confirm(`Retirer ${s.email} de la liste ?`)) return;
    try {
      await api(`/api/admin/${encodeURIComponent(token)}/subscribers/${s.id}`, { method: 'DELETE' });
      toast('Inscrit retiré');
      await load();
    } catch (err) {
      toast(err.message);
    }
  }

  $('copy-public').addEventListener('click', copyPublic);

  $('search').addEventListener('input', (e) => {
    state.query = e.target.value;
    state.shown = PAGE;
    renderRows();
  });

  $('more').querySelector('button').addEventListener('click', () => {
    state.shown += PAGE;
    renderRows();
  });

  document.querySelectorAll('[data-range]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.range = Number(btn.dataset.range);
      document.querySelectorAll('[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      renderChart();
    })
  );

  $('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const title = $('edit-title').value.trim();
    if (!title) return ($('edit-error').textContent = 'Le titre est obligatoire.');
    $('edit-error').textContent = '';
    form.classList.add('is-loading');
    try {
      state.data = await api(`/api/admin/${encodeURIComponent(token)}`, { method: 'PATCH', body: { title, description: $('edit-desc').value } });
      saved.add({ token, slug: state.data.list.slug, title: state.data.list.title });
      render(true);
      toast('Modifications enregistrées');
    } catch (err) {
      $('edit-error').textContent = err.message;
    } finally {
      form.classList.remove('is-loading');
    }
  });

  $('delete-list').addEventListener('click', async () => {
    const name = state.data.list.title;
    const answer = prompt(`Cette action est irréversible.\nTapez « ${name} » pour confirmer la suppression.`);
    if (answer === null) return;
    if (answer.trim() !== name) return toast('Le titre ne correspond pas, suppression annulée');
    try {
      await api(`/api/admin/${encodeURIComponent(token)}`, { method: 'DELETE' });
      saved.remove(token);
      location.href = '/';
    } catch (err) {
      toast(err.message);
    }
  });

  let resizeFrame;
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(renderChart);
  }).observe($('chart'));

  setInterval(() => !document.hidden && load(), 15_000);
  document.addEventListener('visibilitychange', () => !document.hidden && state.data && load());
  load({ first: true });
})();
