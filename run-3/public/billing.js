// Page Abonnement : utilisation, plan actuel, passage à Pro (Stripe Checkout) et gestion (portail Stripe).
const longDate = (ms) => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

function render(plan) {
  if (!plan.billingEnabled) {
    $('plan-summary').textContent = 'Les paiements ne sont pas activés sur ce serveur : votre compte est illimité.';
    document.querySelector('.plans').classList.add('hidden');
    document.querySelector('.usage-panel').classList.add('hidden');
    return;
  }

  // Pastille d'en-tête (rendue par le serveur avant un éventuel retour de Checkout)
  const pill = document.querySelector('.plan-pill');
  if (pill) {
    pill.classList.toggle('pro', plan.pro);
    pill.textContent = plan.pro ? 'Pro' : 'Gratuit';
  }

  // Résumé
  let summary;
  if (!plan.pro) summary = 'Vous êtes sur le plan Gratuit.';
  else if (plan.status === 'past_due') summary = 'Pro — le dernier paiement a échoué. Mettez à jour votre carte pour garder l’accès.';
  else if (plan.cancelAtPeriodEnd && plan.currentPeriodEnd) summary = `Pro jusqu'au ${longDate(plan.currentPeriodEnd)}, puis retour au plan Gratuit.`;
  else if (plan.currentPeriodEnd) summary = `Pro — prochain renouvellement le ${longDate(plan.currentPeriodEnd)}.`;
  else summary = 'Vous êtes sur le plan Pro.';
  $('plan-summary').textContent = summary;

  // Jauge
  const meter = $('meter');
  if (plan.pro) {
    $('usage-sub').textContent = 'Illimité';
    $('meter-fill').style.width = '100%';
    meter.classList.add('unlimited');
    meter.classList.remove('full');
    meter.removeAttribute('aria-valuemax');
    $('usage-text').textContent = `${fmt(plan.used)} inscrit${plan.used > 1 ? 's' : ''} sur l'ensemble de vos listes.`;
  } else {
    const pct = Math.min(100, (plan.used / plan.limit) * 100);
    $('usage-sub').textContent = `${fmt(Math.min(plan.used, plan.limit))} / ${fmt(plan.limit)}`;
    $('meter-fill').style.width = `${pct}%`;
    meter.classList.toggle('full', plan.used >= plan.limit);
    meter.classList.remove('unlimited');
    meter.setAttribute('aria-valuemax', String(plan.limit));
    meter.setAttribute('aria-valuenow', String(Math.min(plan.used, plan.limit)));
    $('usage-text').textContent = plan.locked > 0
      ? `${fmt(plan.locked)} inscrit${plan.locked > 1 ? 's' : ''} verrouillé${plan.locked > 1 ? 's' : ''} : passez à Pro pour voir leurs emails.`
      : `Encore ${fmt(plan.limit - plan.used)} inscrit${plan.limit - plan.used > 1 ? 's' : ''} avant la limite du plan Gratuit.`;
  }

  // Cartes
  $('plan-free').classList.toggle('current', !plan.pro);
  $('plan-pro').classList.toggle('current', plan.pro);
  $('plan-free').querySelector('.plan-current').classList.toggle('hidden', plan.pro);
  $('plan-pro').querySelector('.plan-current').classList.toggle('hidden', !plan.pro);
  $('upgrade-btn').classList.toggle('hidden', plan.pro);
  $('portal-btn').classList.toggle('hidden', !plan.pro && !plan.status);
  $('plan-note').textContent = plan.pro
    ? 'Carte bancaire, factures et résiliation se gèrent sur le portail sécurisé Stripe.'
    : 'Paiement sécurisé par Stripe. Résiliable à tout moment.';
}

async function redirectTo(action, btn) {
  btn.disabled = true;
  $('billing-error').classList.add('hidden');
  try {
    const { url } = await api('POST', `/api/billing/${action}`);
    location.href = url;
  } catch (e) {
    showError($('billing-error'), e.message);
    btn.disabled = false;
  }
}

$('upgrade-btn').addEventListener('click', (e) => redirectTo('checkout', e.currentTarget));
$('portal-btn').addEventListener('click', (e) => redirectTo('portal', e.currentTarget));

(async () => {
  const params = new URLSearchParams(location.search);
  const checkout = params.get('checkout');
  const sessionId = params.get('session_id');
  if (checkout) history.replaceState(null, '', location.pathname);

  try {
    let plan;
    if (checkout === 'success' && sessionId) {
      ({ plan } = await api('POST', '/api/billing/sync', { session_id: sessionId }));
      const n = $('checkout-notice');
      n.textContent = plan.pro
        ? 'Bienvenue dans Pro 🎉 Tous vos inscrits sont débloqués.'
        : 'Paiement reçu, activation en cours… Rechargez la page dans quelques secondes.';
      n.classList.remove('hidden');
    } else {
      ({ plan } = await api('GET', '/api/me'));
      if (checkout === 'cancel') toast('Paiement annulé : aucun montant débité.');
    }
    render(plan);
  } catch (e) {
    showError($('billing-error'), e.message);
  }
})();
