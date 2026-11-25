// Dashboard privé : stats, graphique des inscriptions, liste des inscrits.
const token = decodeURIComponent(location.pathname.split('/')[2] || '');
const api = `/api/d/${encodeURIComponent(token)}`;
const STORE_KEY = 'waitlist:lists';
const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('fr-FR');
const DAYS = 30;

let state = null;
let query = '';

// ---------------------------------------------------------------- Données
async function call(method = 'GET', path = '', body) {
  const res = await fetch(api + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Une erreur est survenue.'), { status: res.status });
  return data;
}

async function load() {
  try {
    state = await call();
    remember();
    render();
  } catch (e) {
    if (state) return; // échec d'un rafraîchissement : on garde l'affichage
    $('app').classList.add('hidden');
    $('error').classList.remove('hidden');
    $('error-text').textContent = e.status === 404 ? 'Ce dashboard est introuvable. Vérifiez le lien.' : e.message;
  }
}

// Mémorise la liste sur cet appareil pour la retrouver depuis l'accueil.
function remember() {
  try {
    const lists = JSON.parse(localStorage.getItem(STORE_KEY)) || [];
    const i = lists.findIndex((l) => l.token === token);
    const entry = { token, slug: state.list.slug, title: state.list.title, createdAt: state.list.created_at };
    if (i === -1) lists.unshift(entry); else lists[i] = entry;
    localStorage.setItem(STORE_KEY, JSON.stringify(lists));
  } catch { /* stockage indisponible : sans importance */ }
}

// ---------------------------------------------------------------- Rendu
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function render() {
  const { list, total, subscribers } = state;
  document.title = `${list.title} — Dashboard`;
  $('list-title').textContent = list.title;
  $('list-meta').textContent = `Créée le ${new Date(list.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`;

  const publicUrl = `${location.origin}/w/${list.slug}`;
  $('public-url').textContent = publicUrl;
  $('view-btn').href = publicUrl;
  $('export-btn').href = `${api}/export.csv`;

  // Comptage par jour (heure locale)
  const counts = new Map();
  for (const s of subscribers) {
    const k = dayKey(new Date(s.created_at));
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const today = startOfDay(new Date());
  const days = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    days.push({ date: d, n: counts.get(dayKey(d)) || 0 });
  }
  const todayN = days[DAYS - 1].n;
  const yesterdayN = days[DAYS - 2].n;
  const week = days.slice(-7).reduce((a, d) => a + d.n, 0);
  const prevWeek = days.slice(-14, -7).reduce((a, d) => a + d.n, 0);

  $('stat-total').textContent = fmt(total);
  $('stat-total-foot').textContent = total === 0 ? 'Votre aventure commence' : `Dernier inscrit ${relative(new Date(subscribers[0].created_at))}`;
  $('stat-today').textContent = fmt(todayN);
  $('stat-today-foot').textContent = `Hier : ${fmt(yesterdayN)}`;
  $('stat-week').textContent = fmt(week);
  $('stat-week-foot').textContent = trend(week, prevWeek);

  renderChart(days);
  renderTable();
}

function trend(cur, prev) {
  if (prev === 0) return cur === 0 ? 'Semaine précédente : 0' : 'Nouveau sur la période';
  const pct = Math.round(((cur - prev) / prev) * 100);
  return `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)} % vs semaine précédente`;
}

function relative(date) {
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 60) return "à l'instant";
  const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  return rtf.format(-Math.round(s / 86400), 'day');
}

// Graphique en barres SVG : barres fines arrondies en haut, ancrées à la base.
const SVG_NS = 'http://www.w3.org/2000/svg';
function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function niceMax(v) {
  if (v <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step;
  return 10 * step;
}

function renderChart(days) {
  const box = $('chart');
  box.querySelector('svg')?.remove();
  const W = box.clientWidth, H = box.clientHeight;
  const pad = { top: 8, right: 4, bottom: 24, left: 32 };
  const iw = W - pad.left - pad.right, ih = H - pad.top - pad.bottom;
  const max = niceMax(Math.max(...days.map((d) => d.n)));
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });

  // Grille et axe Y (4 graduations)
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    const y = pad.top + ih - (v / max) * ih;
    svg.append(el('line', { class: 'gridline', x1: pad.left, x2: W - pad.right, y1: y, y2: y }));
    const t = el('text', { class: 'axis-label', x: pad.left - 8, y: y + 4, 'text-anchor': 'end' });
    t.textContent = Number.isInteger(v) ? fmt(v) : v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    svg.append(t);
  }

  const slot = iw / days.length;
  const bw = Math.max(2, Math.min(18, slot - 4)); // >= 2px d'écart entre barres
  const tooltip = $('tooltip');
  const labelStep = slot * 7 < 90 ? 14 : 7; // espace les dates quand c'est étroit

  days.forEach((d, i) => {
    const cx = pad.left + slot * i + slot / 2;
    const x = cx - bw / 2;
    const base = pad.top + ih;
    const h = d.n === 0 ? 2 : Math.max(4, (d.n / max) * ih);
    const r = Math.min(4, bw / 2, h);
    const g = el('g', { class: 'col', tabindex: '0' });
    // Zone de survol plus large que la barre
    g.append(el('rect', { class: 'hit', x: pad.left + slot * i, y: pad.top, width: slot, height: ih }));
    g.append(el('path', {
      class: d.n === 0 ? 'bar empty' : 'bar',
      d: `M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + bw - r} Q${x + bw},${base - h} ${x + bw},${base - h + r} V${base} Z`,
    }));
    const label = d.date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
    const show = () => {
      tooltip.innerHTML = '';
      const b = document.createElement('b'); b.textContent = `${fmt(d.n)} inscrit${d.n > 1 ? 's' : ''}`;
      tooltip.append(b, document.createElement('br'), label);
      tooltip.style.left = `${Math.min(Math.max(cx, 60), W - 60)}px`;
      tooltip.style.top = `${base - h}px`;
      tooltip.classList.add('show');
    };
    const hide = () => tooltip.classList.remove('show');
    g.addEventListener('mouseenter', show);
    g.addEventListener('focus', show);
    g.addEventListener('mouseleave', hide);
    g.addEventListener('blur', hide);
    svg.append(g);

    // Étiquettes X : une par semaine + aujourd'hui
    if ((days.length - 1 - i) % labelStep === 0) {
      const t = el('text', { class: 'axis-label', x: cx, y: H - 6, 'text-anchor': i === days.length - 1 ? 'end' : 'middle' });
      t.textContent = i === days.length - 1 ? "Aujourd'hui" : d.date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      svg.append(t);
    }
  });

  box.prepend(svg);
}

function renderTable() {
  const { subscribers, total } = state;
  const rows = $('rows');
  const filtered = query ? subscribers.filter((s) => s.email.includes(query)) : subscribers;
  $('table-count').textContent = query ? `· ${fmt(filtered.length)} sur ${fmt(total)}` : `· ${fmt(total)}`;
  $('empty').classList.toggle('hidden', total !== 0);
  $('table-wrap').classList.toggle('hidden', total === 0);

  const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const rankOf = new Map(subscribers.map((s, i) => [s.id, subscribers.length - i]));
  rows.replaceChildren(...filtered.map((s) => {
    const tr = document.createElement('tr');
    const rank = rankOf.get(s.id);
    const cells = [
      ['num', fmt(rank)],
      ['email', s.email],
      ['date', dateFmt.format(new Date(s.created_at))],
    ];
    for (const [cls, text] of cells) {
      const td = document.createElement('td'); td.className = cls; td.textContent = text; tr.append(td);
    }
    const td = document.createElement('td'); td.className = 'act';
    const btn = document.createElement('button');
    btn.className = 'icon-btn'; btn.type = 'button'; btn.title = 'Retirer'; btn.setAttribute('aria-label', `Retirer ${s.email}`);
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/></svg>';
    btn.addEventListener('click', () => removeSub(s));
    td.append(btn); tr.append(td);
    return tr;
  }));

  if (filtered.length === 0 && total > 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td'); td.colSpan = 4; td.className = 'date'; td.textContent = 'Aucun email ne correspond à la recherche.';
    tr.append(td); rows.append(tr);
  }
}

// ---------------------------------------------------------------- Actions
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

async function copy(text, ok) {
  try { await navigator.clipboard.writeText(text); toast(ok); }
  catch { prompt('Copiez ce lien :', text); }
}

async function removeSub(s) {
  if (!confirm(`Retirer ${s.email} de la liste ?`)) return;
  try {
    state = await call('DELETE', `/subscribers/${s.id}`);
    render();
    toast('Inscrit retiré');
  } catch (e) { toast(e.message); }
}

$('copy-public').addEventListener('click', () => copy($('public-url').textContent, 'Lien public copié'));
$('copy-dash').addEventListener('click', () => copy(location.origin + location.pathname, 'Lien privé copié'));
$('search').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); if (state) renderTable(); });

const dialog = $('edit-dialog');
$('edit-btn').addEventListener('click', () => {
  if (!state) return;
  $('edit-title').value = state.list.title;
  $('edit-description').value = state.list.description;
  $('edit-error').classList.add('hidden');
  dialog.showModal();
});
$('edit-cancel').addEventListener('click', () => dialog.close());
$('edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('edit-title').value.trim();
  const err = $('edit-error');
  if (!title) { err.textContent = 'Le titre est obligatoire.'; err.classList.remove('hidden'); return; }
  try {
    state = await call('PATCH', '', { title, description: $('edit-description').value });
    remember();
    render();
    dialog.close();
    toast('Modifications enregistrées');
  } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
});

if (new URLSearchParams(location.search).has('new')) {
  $('new-notice').classList.remove('hidden');
  history.replaceState(null, '', location.pathname);
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => state && render(), 120);
});
setInterval(() => { if (!document.hidden && !dialog.open) load(); }, 20_000);

load();
