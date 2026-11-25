// Petits utilitaires partagés par les pages de l'app.
window.WL = (() => {
  const fmt = new Intl.NumberFormat('fr-FR');

  let toastTimer;
  function toast(message) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  async function copy(text, message = 'Lien copié') {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(message);
  }

  const loginUrl = () => `/login?next=${encodeURIComponent(location.pathname)}`;

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      credentials: 'same-origin',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Session expirée pendant l'utilisation : retour à la connexion.
      if (res.status === 401 && !options.noAuthRedirect) location.href = loginUrl();
      const err = new Error(data.error || 'Une erreur est survenue.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /** Affiche l'utilisateur connecté dans la barre du haut. */
  function showUser(user) {
    const menu = document.querySelector('[data-usermenu]');
    if (!menu || !user) return;
    menu.querySelector('[data-user-email]').textContent = user.email;
    menu.querySelector('[data-user-initial]').textContent = user.email[0];
    menu.hidden = false;
  }

  document.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-logout]')) return;
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    location.href = '/';
  });

  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children.filter((c) => c != null));
    return node;
  };

  // --- Facturation ----------------------------------------------------------
  /** Redirige vers Stripe (Checkout pour s'abonner, portail pour gérer l'abonnement). */
  async function goToStripe(kind, button) {
    if (button) {
      button.disabled = true;
      button.classList.add('is-loading');
    }
    try {
      const { url } = await api(`/api/billing/${kind}`, { method: 'POST' });
      location.href = url;
    } catch (err) {
      toast(err.message);
      if (button) {
        button.disabled = false;
        button.classList.remove('is-loading');
      }
    }
  }
  const startCheckout = (button) => goToStripe('checkout', button);
  const openPortal = (button) => goToStripe('portal', button);

  const fmtDay = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  function upgradeButton(plan, label = 'Passer à Pro · 9 €/mois') {
    if (!plan.billingEnabled) return el('span', { className: 'muted small', textContent: 'Paiements non configurés sur ce serveur.' });
    const btn = el('button', { className: 'btn btn-primary', type: 'button' },
      el('span', { className: 'btn-label', textContent: label }),
      el('span', { className: 'spinner', ariaHidden: 'true' }));
    btn.addEventListener('click', () => startCheckout(btn));
    return btn;
  }

  /** Carte « plan » : jauge du quota en gratuit, état de l'abonnement en Pro. */
  function renderPlan(container, plan, { activating = false } = {}) {
    const pro = plan.plan === 'pro';
    const badge = el('span', { className: `plan-badge ${pro ? 'pro' : ''}`, textContent: pro ? 'Pro' : 'Gratuit' });
    let body;
    let action;

    if (pro) {
      let status = 'Inscrits illimités.';
      if (plan.status === 'past_due') status = 'Le dernier paiement a échoué : mettez à jour votre moyen de paiement pour garder le plan Pro.';
      else if (plan.cancelAtPeriodEnd && plan.periodEnd) status = `Inscrits illimités jusqu’au ${fmtDay.format(new Date(plan.periodEnd))}, puis retour au plan gratuit.`;
      else if (plan.periodEnd) status = `Inscrits illimités. Prochain renouvellement le ${fmtDay.format(new Date(plan.periodEnd))}.`;
      body = el('div', { className: 'plan-body' },
        el('div', { className: 'plan-line' }, badge, el('strong', { textContent: `${fmt.format(plan.used)} ${plan.used > 1 ? 'inscrits' : 'inscrit'}` })),
        el('p', { className: plan.status === 'past_due' ? 'plan-hint warn' : 'plan-hint', textContent: status }));
      if (plan.billingEnabled) {
        action = el('button', { className: 'btn btn-ghost', type: 'button' },
          el('span', { className: 'btn-label', textContent: 'Gérer l’abonnement' }),
          el('span', { className: 'spinner', ariaHidden: 'true' }));
        action.addEventListener('click', () => openPortal(action));
      }
    } else {
      const ratio = Math.min(1, plan.used / plan.limit);
      const level = ratio >= 1 ? 'full' : ratio >= 0.8 ? 'high' : '';
      const meter = el('div', { className: `meter ${level}`, role: 'meter' });
      meter.setAttribute('aria-valuemin', '0');
      meter.setAttribute('aria-valuemax', String(plan.limit));
      meter.setAttribute('aria-valuenow', String(Math.min(plan.used, plan.limit)));
      meter.setAttribute('aria-label', 'Quota d’inscrits du plan gratuit');
      const fill = el('span');
      fill.style.width = `${ratio * 100}%`;
      meter.append(fill);

      let hint = `Le plan gratuit affiche jusqu’à ${plan.limit} inscrits, toutes listes confondues.`;
      if (activating) hint = 'Paiement reçu : activation de votre plan Pro en cours…';
      else if (plan.hidden > 0) hint = `${fmt.format(plan.hidden)} ${plan.hidden > 1 ? 'inscrits sont enregistrés mais masqués' : 'inscrit est enregistré mais masqué'}. Passez Pro pour les voir et les exporter.`;
      else if (level === 'high') hint = `Vous approchez de la limite. Au-delà de ${plan.limit}, les nouveaux inscrits restent enregistrés mais sont masqués.`;

      body = el('div', { className: 'plan-body' },
        el('div', { className: 'plan-line' }, badge,
          el('strong', { textContent: `${fmt.format(plan.used)} / ${fmt.format(plan.limit)} inscrits` }),
          plan.hidden > 0 ? el('span', { className: 'plan-over', textContent: `+${fmt.format(plan.hidden)} masqués` }) : null),
        meter,
        el('p', { className: 'plan-hint', textContent: hint }));
      action = activating ? el('span', { className: 'spinner plan-spinner', ariaHidden: 'true' }) : upgradeButton(plan);
    }
    container.replaceChildren(body, action || '');
    container.classList.toggle('is-pro', pro);
    container.hidden = false;
  }

  return { fmt, toast, copy, api, el, showUser, startCheckout, openPortal, renderPlan, upgradeButton };
})();
