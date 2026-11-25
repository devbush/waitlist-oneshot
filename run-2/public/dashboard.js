(() => {
  const data = JSON.parse(document.getElementById('dash-data').textContent);
  const dates = data.dates.map((d) => new Date(d));
  const KEY = 'waitlist:lists';

  /* ---------- Mémorise la liste sur cet appareil (accès depuis l'accueil) */
  const readLists = () => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const writeLists = (lists) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(lists));
    } catch {}
  };
  writeLists([{ token: data.token, title: data.title, slug: data.slug }, ...readLists().filter((l) => l.token !== data.token)].slice(0, 30));

  /* ---------- Boutons copier */
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.dataset.copy;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const input = btn.parentElement.querySelector('input');
        input?.select();
        document.execCommand('copy');
      }
      const old = btn.textContent;
      btn.textContent = 'Copié ✓';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = old;
        btn.classList.remove('copied');
      }, 1600);
    });
  });
  document.querySelectorAll('.copy-field input').forEach((i) => i.addEventListener('focus', () => i.select()));

  /* ---------- Confirmations */
  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (!confirm(form.dataset.confirm)) return e.preventDefault();
      if (form.action.endsWith('/delete') && !form.action.includes('/subscribers/')) {
        writeLists(readLists().filter((l) => l.token !== data.token));
      }
    });
  });

  /* ---------- Nettoie l'URL des flags (?created=1…) */
  if (location.search) history.replaceState(null, '', location.pathname);

  /* ---------- Dates locales */
  const fmtFull = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  document.querySelectorAll('time[datetime]').forEach((t) => {
    const d = new Date(t.getAttribute('datetime'));
    t.textContent = fmtFull.format(d);
    t.title = d.toLocaleString('fr-FR');
  });

  /* ---------- Recherche */
  const search = document.getElementById('search');
  if (search) {
    const rows = [...document.querySelectorAll('tbody tr[data-email]')];
    const noMatch = document.getElementById('no-match');
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      for (const r of rows) {
        const ok = !q || r.dataset.email.includes(q);
        r.hidden = !ok;
        if (ok) shown++;
      }
      noMatch.hidden = shown > 0;
    });
  }

  /* ---------- Agrégation par jour (fuseau local) */
  const DAYS = 30;
  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push({ date: d, key: dayKey(d), count: 0 });
  }
  const index = new Map(days.map((d) => [d.key, d]));
  for (const d of dates) {
    const slot = index.get(dayKey(d));
    if (slot) slot.count++;
  }

  /* ---------- Stats */
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const todayCount = days[DAYS - 1].count;
  const yesterdayCount = days[DAYS - 2].count;
  const week = days.slice(-7).reduce((s, d) => s + d.count, 0);
  const prevWeek = days.slice(-14, -7).reduce((s, d) => s + d.count, 0);
  const setStat = (k, v) => {
    const el = document.querySelector(`[data-stat="${k}"]`);
    if (el) el.textContent = v;
  };
  setStat('today', todayCount);
  setStat('today-sub', `hier : ${yesterdayCount}`);
  setStat('week', week);
  setStat(
    'week-sub',
    prevWeek === 0
      ? week > 0 ? 'semaine précédente : 0' : 'aucune inscription'
      : `${week >= prevWeek ? '↑' : '↓'} ${Math.abs(Math.round(((week - prevWeek) / prevWeek) * 100))} % vs semaine préc.`
  );
  setStat('since', `depuis le ${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(data.createdAt))}`);

  /* ---------- Histogramme */
  const chart = document.getElementById('chart');
  const fmtDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtTick = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };

  function niceMax(v) {
    if (v <= 4) return 4;
    const pow = 10 ** Math.floor(Math.log10(v));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
    return 10 * pow;
  }

  // Barre arrondie en haut (4px), ancrée à la ligne de base
  function barPath(x, y, w, h) {
    const r = Math.min(4, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  let tip;
  function render() {
    const W = chart.clientWidth;
    const H = chart.clientHeight;
    if (!W || !H) return;
    chart.innerHTML = '';
    const pad = { top: 12, right: 4, bottom: 26, left: 34 };
    const iw = W - pad.left - pad.right;
    const ih = H - pad.top - pad.bottom;
    const max = niceMax(Math.max(...days.map((d) => d.count)));
    const ticks = 4;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });

    const grid = el('g', { class: 'grid' });
    for (let i = 0; i <= ticks; i++) {
      const v = (max / ticks) * i;
      const y = pad.top + ih - (v / max) * ih;
      if (i > 0) grid.append(el('line', { x1: pad.left, x2: W - pad.right, y1: y, y2: y }));
      const label = el('text', { x: pad.left - 10, y: y + 4, 'text-anchor': 'end', class: 'tick' });
      label.textContent = Number.isInteger(v) ? v : v.toFixed(1);
      grid.append(label);
    }
    svg.append(grid);

    const slot = iw / DAYS;
    const gap = Math.max(2, slot * 0.28);
    const bw = Math.max(2, slot - gap);
    const bars = el('g');
    const hits = el('g');
    days.forEach((d, i) => {
      const x = pad.left + i * slot + (slot - bw) / 2;
      const h = d.count ? Math.max(3, (d.count / max) * ih) : 2;
      const y = pad.top + ih - h;
      const bar = el('path', { d: barPath(x, y, bw, h), class: d.count ? 'bar' : 'bar zero' });
      bars.append(bar);
      const hit = el('rect', { x: pad.left + i * slot, y: pad.top, width: slot, height: ih, class: 'hit' });
      hit.addEventListener('pointerenter', () => showTip(i, bar, hit, x + bw / 2, y));
      hit.addEventListener('pointerleave', hideTip);
      hits.append(hit);

      const every = W < 520 ? 10 : 5;
      if ((DAYS - 1 - i) % every === 0) {
        const t = el('text', { x: x + bw / 2, y: H - 6, 'text-anchor': 'middle', class: 'tick' });
        t.textContent = i === DAYS - 1 ? 'Auj.' : fmtTick.format(d.date).replace('.', '');
        svg.append(t);
      }
    });
    svg.append(hits, bars);
    svg.append(el('line', { x1: pad.left, x2: W - pad.right, y1: pad.top + ih + 0.5, y2: pad.top + ih + 0.5, class: 'baseline' }));
    bars.style.pointerEvents = 'none';
    chart.append(svg);

    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    chart.append(tip);
  }

  function showTip(i, bar, hit, cx, top) {
    const d = days[i];
    chart.classList.add('hovering');
    chart.querySelectorAll('.active').forEach((n) => n.classList.remove('active'));
    bar.classList.add('active');
    hit.classList.add('active');
    tip.innerHTML = '';
    const strong = document.createElement('strong');
    strong.textContent = plural(d.count, 'inscription', 'inscriptions');
    tip.append(strong, fmtDay.format(d.date));
    tip.hidden = false;
    const half = 70;
    tip.style.left = `${Math.min(Math.max(cx, half), chart.clientWidth - half)}px`;
    tip.style.top = `${top}px`;
  }
  function hideTip() {
    chart.classList.remove('hovering');
    chart.querySelectorAll('.active').forEach((n) => n.classList.remove('active'));
    if (tip) tip.hidden = true;
  }

  render();
  let raf;
  new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(render);
  }).observe(chart);

  /* ---------- Vue tableau du graphique */
  const toggle = document.getElementById('chart-toggle');
  const tableBox = document.getElementById('chart-table');
  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>Jour</th><th>Inscriptions</th></tr></thead>';
  const tb = document.createElement('tbody');
  [...days].reverse().forEach((d) => {
    const tr = document.createElement('tr');
    const a = document.createElement('td');
    a.textContent = fmtDay.format(d.date);
    const b = document.createElement('td');
    b.textContent = d.count;
    tr.append(a, b);
    tb.append(tr);
  });
  table.append(tb);
  tableBox.append(table);
  toggle.addEventListener('click', () => {
    const showTable = tableBox.hidden;
    tableBox.hidden = !showTable;
    chart.hidden = showTable;
    toggle.setAttribute('aria-pressed', String(showTable));
    toggle.textContent = showTable ? 'Voir le graphique' : 'Voir en tableau';
    if (!showTable) render();
  });
})();
