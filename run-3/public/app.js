// « Mes listes » : listes du compte connecté + création.
const LEGACY_KEY = 'waitlist:lists'; // listes créées avant les comptes (jetons secrets)

function tile(l) {
  const a = document.createElement('a');
  a.className = 'card list-tile';
  a.href = `/app/lists/${encodeURIComponent(l.slug)}`;

  const h = document.createElement('h3'); h.textContent = l.title;
  const p = document.createElement('p');
  p.textContent = `Créée le ${new Date(l.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`;

  const stats = document.createElement('div'); stats.className = 'tile-stats';
  const total = document.createElement('div');
  const tv = document.createElement('b'); tv.textContent = fmt(l.total);
  const tk = document.createElement('span'); tk.textContent = l.total > 1 ? ' inscrits' : ' inscrit';
  total.append(tv, tk);
  const week = document.createElement('div'); week.className = l.last7 > 0 ? 'tile-week up' : 'tile-week';
  week.textContent = l.last7 > 0 ? `+${fmt(l.last7)} cette semaine` : 'Rien cette semaine';
  stats.append(total, week);

  a.append(h, p, stats);
  if (l.locked > 0) {
    const lock = document.createElement('div'); lock.className = 'tile-locked';
    lock.textContent = `🔒 ${fmt(l.locked)} inscrit${l.locked > 1 ? 's' : ''} verrouillé${l.locked > 1 ? 's' : ''}`;
    a.append(lock);
  }
  return a;
}

function renderPlan(plan) {
  const banner = $('plan-banner');
  banner.classList.toggle('hidden', !plan.billingEnabled || plan.pro);
  if (!plan.billingEnabled || plan.pro) return;
  const shown = Math.min(plan.used, plan.limit);
  banner.classList.toggle('warn', plan.used >= plan.limit);
  $('plan-banner-fill').style.width = `${(shown / plan.limit) * 100}%`;
  if (plan.locked > 0) {
    $('plan-banner-title').textContent = `${fmt(plan.locked)} inscrit${plan.locked > 1 ? 's' : ''} verrouillé${plan.locked > 1 ? 's' : ''}`;
    $('plan-banner-sub').textContent = `Vous avez dépassé les ${fmt(plan.limit)} inscrits du plan Gratuit. Rien n'est perdu : passez à Pro pour tout débloquer.`;
  } else {
    $('plan-banner-title').textContent = `${fmt(plan.used)} / ${fmt(plan.limit)} inscrits`;
    $('plan-banner-sub').textContent = plan.used >= plan.limit
      ? 'Limite du plan Gratuit atteinte : les prochains inscrits seront verrouillés.'
      : 'Plan Gratuit, toutes listes confondues. Passez à Pro pour des inscrits illimités.';
  }
}

async function load() {
  const { lists, plan } = await api('GET', '/api/lists');
  renderPlan(plan);
  const total = lists.reduce((s, l) => s + l.total, 0);
  $('lists-meta').textContent = lists.length === 0
    ? 'Commencez par créer une liste.'
    : `${fmt(lists.length)} liste${lists.length > 1 ? 's' : ''} · ${fmt(total)} inscrit${total > 1 ? 's' : ''} au total`;
  $('lists-grid').replaceChildren(...lists.map(tile));
  $('lists-grid').classList.toggle('hidden', lists.length === 0);
  $('empty').classList.toggle('hidden', lists.length !== 0);
}

// Rattache au compte les listes créées sur cet appareil avant l'arrivée des comptes.
async function claimLegacy() {
  let legacy;
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY)) || []; } catch { return 0; }
  let claimed = 0;
  for (const l of legacy) {
    try { await api('POST', '/api/lists/claim', { token: l.token }); claimed++; } catch { /* appartient à un autre compte ou supprimée */ }
  }
  localStorage.removeItem(LEGACY_KEY);
  return claimed;
}

const dialog = $('create-dialog');
const form = $('create-form');
function openCreate() {
  form.reset();
  $('create-error').classList.add('hidden');
  dialog.showModal();
  form.title.focus();
}
$('new-btn').addEventListener('click', openCreate);
$('empty-new-btn').addEventListener('click', openCreate);
$('create-cancel').addEventListener('click', () => dialog.close());

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = form.title.value.trim();
  if (!title) { showError($('create-error'), 'Donnez un nom à votre projet.'); form.title.focus(); return; }
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const { slug } = await api('POST', '/api/lists', { title, description: form.description.value });
    location.href = `/app/lists/${encodeURIComponent(slug)}?new=1`;
  } catch (ex) {
    showError($('create-error'), ex.message);
    btn.disabled = false;
  }
});

(async () => {
  try {
    const claimed = await claimLegacy();
    await load();
    if (claimed) toast(`${claimed} liste${claimed > 1 ? 's' : ''} existante${claimed > 1 ? 's' : ''} rattachée${claimed > 1 ? 's' : ''} à votre compte`);
  } catch (e) {
    $('lists-meta').textContent = e.message;
  }
})();
