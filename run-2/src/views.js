import { FREE_LIMIT, PRO_PRICE_EUR, isPro } from './plans.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const jsonScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

const logo = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c6cff"/><stop offset="1" stop-color="#e255c8"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#lg)"/><path d="M9 11.5h14M9 16h10M9 20.5h6" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>`;

const aurora = `<div class="aurora" aria-hidden="true"><span></span><span></span><span></span></div>`;

const fmtDateFallback = (iso) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
const fmtDay = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const lockIcon = `<svg class="lock-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`;
const checkIcon = `<svg class="check-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const fmtUnix = (sec) => new Date(sec * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const plural = (n, one, many) => (n <= 1 ? one : many); // en français, 0 et 1 sont au singulier

function layout({ title, body, bodyClass = '', scripts = [], description = '' }) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ''}
<meta property="og:title" content="${esc(title)}">
${description ? `<meta property="og:description" content="${esc(description)}">` : ''}
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/style.css">
</head>
<body class="${bodyClass}">
${body}
${scripts.map((s) => `<script src="/static/${s}" defer></script>`).join('\n')}
</body>
</html>`;
}

/** Barre de navigation, différente selon qu'on est connecté ou non. */
function nav(user, { sticky = false } = {}) {
  const right = user
    ? `<a class="nav-link" href="/lists">Mes listes</a>
       ${isPro(user) ? '<a class="plan-pill pro" href="/billing" title="Gérer mon abonnement">Pro</a>' : '<a class="nav-link" href="/billing">Abonnement</a>'}
       <span class="user-chip" title="${esc(user.email)}"><span class="avatar" aria-hidden="true">${esc(user.email[0].toUpperCase())}</span><span class="user-email">${esc(user.email)}</span></span>
       <form method="post" action="/logout"><button class="btn ghost sm" type="submit">Déconnexion</button></form>`
    : `<a class="nav-link" href="/login">Connexion</a>
       <a class="btn primary sm" href="/signup">Créer un compte</a>`;
  return `<header class="nav${sticky ? ' sticky' : ''}">
  <a class="brand" href="${user ? '/lists' : '/'}">${logo}<span>Waitlist</span></a>
  <nav class="nav-right" aria-label="Compte">${right}</nav>
</header>`;
}

/* ------------------------------------------------------------ Plans & quota */

/** Jauge du quota gratuit (ou rappel du plan Pro). */
function usageMeter(user, usage, { cta = true } = {}) {
  if (isPro(user)) {
    return `<div class="card usage is-pro">
      <div class="usage-text">
        <span class="plan-pill pro">Pro</span>
        <span><strong>Inscrits illimités</strong> · ${usage.total} ${plural(usage.total, 'inscrit', 'inscrits')} au total</span>
      </div>
      ${cta ? '<a class="btn ghost sm" href="/billing">Gérer l’abonnement</a>' : ''}
    </div>`;
  }
  const used = Math.min(usage.total, FREE_LIMIT);
  const pct = Math.round((used / FREE_LIMIT) * 100);
  const state = usage.total >= FREE_LIMIT ? 'full' : pct >= 80 ? 'near' : 'ok';
  const left = FREE_LIMIT - used;
  const label =
    state === 'full'
      ? usage.locked
        ? `${lockIcon}<span><strong>Quota gratuit atteint</strong> · ${usage.locked} ${plural(usage.locked, 'inscrit verrouillé', 'inscrits verrouillés')}</span>`
        : `${lockIcon}<span><strong>Quota gratuit atteint</strong> · les prochains inscrits seront verrouillés</span>`
      : state === 'near'
        ? `<span class="warn-mark" aria-hidden="true">!</span><span><strong>Plus que ${left} ${plural(left, 'place gratuite', 'places gratuites')}</strong></span>`
        : `<span><strong>Plan gratuit</strong> · encore ${left} ${plural(left, 'place', 'places')}</span>`;
  return `<div class="card usage state-${state}">
    <div class="usage-main">
      <div class="usage-text">${label}<span class="usage-count">${used} / ${FREE_LIMIT}</span></div>
      <svg class="meter" width="100%" height="8" role="img" aria-label="${used} inscrits sur ${FREE_LIMIT} inclus dans le plan gratuit">
        <rect class="meter-track" width="100%" height="8" rx="4"/>
        ${used ? `<rect class="meter-fill" width="${pct}%" height="8" rx="4"/>` : ''}
      </svg>
    </div>
    ${cta ? `<a class="btn ${state === 'ok' ? 'ghost' : 'primary'} sm" href="/billing">${state === 'full' ? 'Tout débloquer' : 'Passer en Pro'}</a>` : ''}
  </div>`;
}

/** Cartes des deux plans (accueil et page Abonnement). */
function planCards({ user = null, stripeEnabled = true } = {}) {
  const pro = isPro(user);
  const freeFeatures = [`${FREE_LIMIT} inscrits inclus`, 'Listes illimitées', 'Page publique & formulaire', 'Dashboard, stats et export CSV'];
  const proFeatures = ['Inscrits illimités', 'Tout le plan gratuit', 'Déblocage immédiat des inscrits verrouillés', 'Sans engagement, annulable à tout moment'];
  const features = (items) => `<ul class="plan-features">${items.map((f) => `<li>${checkIcon}${esc(f)}</li>`).join('')}</ul>`;

  let freeCta, proCta;
  if (!user) {
    freeCta = '<a class="btn block" href="/signup">Commencer gratuitement</a>';
    proCta = '<a class="btn primary block" href="/signup">Créer un compte</a>';
  } else if (pro) {
    freeCta = '<p class="plan-note">Vous repasserez sur ce plan si vous annulez.</p>';
    proCta = `<form method="post" action="/billing/portal"><button class="btn block" type="submit">Gérer mon abonnement</button></form>`;
  } else {
    freeCta = '<p class="plan-note">Votre plan actuel.</p>';
    proCta = stripeEnabled
      ? `<form method="post" action="/billing/checkout"><button class="btn primary block" type="submit">Passer en Pro, ${PRO_PRICE_EUR} €/mois</button></form>`
      : '<button class="btn primary block" type="button" disabled>Paiement indisponible</button>';
  }
  const current = '<span class="plan-current">Plan actuel</span>';
  return `<div class="plans">
    <article class="card plan">
      <header><h3>Gratuit</h3>${user && !pro ? current : ''}</header>
      <p class="plan-price"><strong>0 €</strong></p>
      <p class="muted">Pour lancer et valider une idée.</p>
      ${features(freeFeatures)}
      ${freeCta}
    </article>
    <article class="card plan plan-pro">
      <header><h3>Pro</h3>${pro ? current : '<span class="plan-badge">Illimité</span>'}</header>
      <p class="plan-price"><strong>${PRO_PRICE_EUR} €</strong><span>/ mois</span></p>
      <p class="muted">Pour les lancements qui décollent.</p>
      ${features(proFeatures)}
      ${proCta}
    </article>
  </div>`;
}

/* ---------------------------------------------------------------- Accueil */

export function home() {
  const body = `
${aurora}
${nav(null)}
<main class="home">
  <section class="hero">
    <span class="eyebrow"><span class="spark">✦</span> Listes d'attente, sans prise de tête</span>
    <h1>Faites monter l'impatience <em>avant</em> le lancement.</h1>
    <p class="lead">Créez une page d'inscription élégante pour votre projet, partagez le lien, et suivez vos inscrits depuis un dashboard clair.</p>
    <ul class="perks">
      <li><span>1</span> Une page publique prête à partager</li>
      <li><span>2</span> Un formulaire email anti-doublons</li>
      <li><span>3</span> Un dashboard avec stats et export CSV</li>
    </ul>
    <div class="cta-row">
      <a class="btn primary" href="/signup">Créer mon compte gratuit <span aria-hidden="true">→</span></a>
      <a class="btn ghost" href="/login">J’ai déjà un compte</a>
    </div>
  </section>

  <div class="preview" aria-hidden="true">
    <div class="card preview-card">
      <span class="eyebrow live"><span class="dot"></span> Bientôt disponible</span>
      <p class="preview-title">Nébula</p>
      <p class="preview-desc">L’agenda qui organise vos journées tout seul.</p>
      <div class="join-row"><span class="fake-input">vous@exemple.com</span><span class="btn primary sm">Rejoindre</span></div>
      <p class="social-proof"><span class="avatars"><i></i><i></i><i></i></span><span><strong>1 284</strong> personnes déjà inscrites</span></p>
    </div>
    <div class="card preview-stat">
      <span class="stat-label">Cette semaine</span>
      <strong>+312</strong>
      <span class="mini-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
    </div>
  </div>

  <section class="pricing" id="tarifs">
    <h2>Des tarifs simples</h2>
    <p class="lead">Gratuit jusqu’à ${FREE_LIMIT} inscrits. Ensuite, ${PRO_PRICE_EUR} € par mois pour des inscrits illimités.</p>
    ${planCards()}
  </section>
</main>`;
  return layout({ title: 'Waitlist · Créez votre liste d’attente', body, bodyClass: 'page-home' });
}

/* ------------------------------------------------ Connexion / inscription */

export function authPage({ mode, error = '', email = '', next = '' }) {
  const signup = mode === 'signup';
  const action = signup ? '/signup' : '/login';
  const body = `
${aurora}
${nav(null)}
<main class="auth">
  <form class="card auth-card" method="post" action="${action}">
    <div class="auth-head">
      ${logo}
      <h1>${signup ? 'Créer un compte' : 'Bon retour !'}</h1>
      <p class="muted">${signup ? 'Lancez votre première liste d’attente en une minute.' : 'Connectez-vous pour retrouver vos listes.'}</p>
    </div>
    ${error ? `<p class="alert error" role="alert">${esc(error)}</p>` : ''}
    ${next ? `<input type="hidden" name="next" value="${esc(next)}">` : ''}
    <label class="field">
      <span>Email</span>
      <input type="email" name="email" required maxlength="254" autocomplete="email" value="${esc(email)}" ${email ? '' : 'autofocus'}>
    </label>
    <label class="field">
      <span>Mot de passe ${signup ? '<small>8 caractères minimum</small>' : ''}</span>
      <input type="password" name="password" required ${signup ? 'minlength="8"' : ''} maxlength="200" autocomplete="${signup ? 'new-password' : 'current-password'}" ${email ? 'autofocus' : ''}>
    </label>
    <button class="btn primary block" type="submit">${signup ? 'Créer mon compte' : 'Se connecter'}</button>
    <p class="hint">${
      signup
        ? `Déjà inscrit·e ? <a href="/login${next ? `?next=${encodeURIComponent(next)}` : ''}">Se connecter</a>`
        : `Pas encore de compte ? <a href="/signup${next ? `?next=${encodeURIComponent(next)}` : ''}">Créer un compte</a>`
    }</p>
  </form>
</main>`;
  return layout({ title: `${signup ? 'Créer un compte' : 'Connexion'} · Waitlist`, body, bodyClass: 'page-auth' });
}

/* ----------------------------------------------------------- Mes listes */

export function listsPage({ user, usage, lists, error = '', values = {}, flags = {} }) {
  const cards = lists
    .map(
      (l) => `
    <li class="card list-card">
      <a class="list-main" href="/lists/${esc(l.slug)}">
        <h3>${esc(l.title)}</h3>
        <p class="muted">Créée le ${esc(fmtDay(l.created_at))}</p>
        <div class="list-stats">
          <span><strong>${l.total}</strong> ${plural(l.total, 'inscrit', 'inscrits')}</span>
          ${l.week ? `<span class="trend">+${l.week} cette semaine</span>` : ''}
          ${l.locked ? `<span class="locked-chip">${lockIcon}${l.locked} ${plural(l.locked, 'verrouillé', 'verrouillés')}</span>` : ''}
        </div>
      </a>
      <div class="list-foot">
        <a href="/lists/${esc(l.slug)}">Ouvrir le dashboard <span aria-hidden="true">→</span></a>
        <a href="/w/${esc(l.slug)}" target="_blank" rel="noopener" class="muted">Page publique ↗</a>
      </div>
    </li>`
    )
    .join('');

  const flash = flags.deleted
    ? `<p class="toast" role="status">Liste supprimée ✓</p>`
    : flags.claimed
      ? `<p class="toast" role="status">Liste rattachée à votre compte ✓</p>`
      : '';

  const body = `
${nav(user, { sticky: true })}
<main class="dash lists-page">
  ${flash}
  <section class="dash-head">
    <div>
      <p class="eyebrow">Espace de ${esc(user.email)}</p>
      <h1>Mes listes</h1>
    </div>
    <a class="btn primary sm jump-new" href="#new">+ Nouvelle liste</a>
  </section>
  ${usageMeter(user, usage)}

  <div class="lists-layout">
    <section>
      ${
        lists.length
          ? `<ul class="list-grid">${cards}</ul>`
          : `<div class="card empty-state">
          <div class="empty-icon" aria-hidden="true">🚀</div>
          <h3>Aucune liste pour l’instant</h3>
          <p>Créez votre première liste d’attente avec le formulaire. Elle sera en ligne immédiatement.</p>
        </div>`
      }
    </section>

    <form class="card create" method="post" action="/lists" id="new">
      <h2>Nouvelle liste</h2>
      ${error ? `<p class="alert error" role="alert">${esc(error)}</p>` : ''}
      <label class="field">
        <span>Titre du projet</span>
        <input name="title" required maxlength="80" value="${esc(values.title)}" placeholder="Ex. Nebula, l'agenda qui pense pour vous" ${lists.length ? '' : 'autofocus'}>
      </label>
      <label class="field">
        <span>Description <small>optionnelle</small></span>
        <textarea name="description" maxlength="600" rows="4" placeholder="Dites en deux phrases pourquoi on devrait s'inscrire.">${esc(values.description)}</textarea>
      </label>
      <button class="btn primary block" type="submit">Créer la liste <span aria-hidden="true">→</span></button>
    </form>
  </div>
</main>`;
  return layout({ title: 'Mes listes · Waitlist', body, bodyClass: 'page-dash' });
}

/* ---------------------------------------------------------- Page publique */

export function publicPage({ list, count, status }) {
  const joined = status === 'ok' || status === 'already';
  const proof =
    count > 0
      ? `<strong data-count>${count}</strong> <span data-count-label>${plural(count, 'personne déjà inscrite', 'personnes déjà inscrites')}</span>`
      : `<span data-count-label>Soyez parmi les premiers à vous inscrire</span>`;
  const errorMsg =
    status === 'invalid'
      ? 'Cette adresse email ne semble pas valide.'
      : status === 'limit'
        ? 'Trop de tentatives, réessayez dans une minute.'
        : '';

  const body = `
${aurora}
<main class="public">
  <article class="card public-card">
    <span class="eyebrow live"><span class="dot"></span> Bientôt disponible</span>
    <h1>${esc(list.title)}</h1>
    ${list.description ? `<p class="desc">${esc(list.description)}</p>` : ''}

    <form class="join" method="post" action="/w/${esc(list.slug)}" ${joined ? 'hidden' : ''} novalidate>
      <div class="hp" aria-hidden="true">
        <label>Ne pas remplir <input type="text" name="website" tabindex="-1" autocomplete="off"></label>
      </div>
      <div class="join-row">
        <input type="email" name="email" required maxlength="254" placeholder="vous@exemple.com" aria-label="Votre adresse email" autocomplete="email">
        <button class="btn primary" type="submit"><span class="label">Rejoindre la liste</span><span class="spinner" aria-hidden="true"></span></button>
      </div>
      <p class="form-msg${errorMsg ? ' error' : ''}" role="status" aria-live="polite">${esc(errorMsg)}</p>
    </form>

    <div class="success" ${joined ? '' : 'hidden'} role="status" aria-live="polite">
      <svg class="check" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-15"/></svg>
      <h2 data-success-title>${status === 'already' ? 'Vous étiez déjà inscrit·e !' : 'Vous êtes sur la liste !'}</h2>
      <p data-success-text>On vous prévient par email dès que c’est prêt.</p>
    </div>

    <p class="social-proof">
      <span class="avatars" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>${proof}</span>
    </p>
  </article>
  <footer class="powered">Propulsé par <a href="/">${logo} Waitlist</a></footer>
</main>`;
  return layout({
    title: list.title,
    description: list.description.slice(0, 160),
    body,
    bodyClass: 'page-public',
    scripts: ['public.js'],
  });
}

/* -------------------------------------------------------------- Dashboard */

export function dashboard({ user, list, subscribers, baseUrl, flags }) {
  const publicUrl = `${baseUrl}/w/${list.slug}`;
  const total = subscribers.length;
  const base = `/lists/${esc(list.slug)}`;

  const pro = isPro(user);
  const lockedCount = subscribers.filter((s) => s.locked).length;
  const rows = subscribers
    .map((s, i) =>
      s.locked
        ? // Inscrit verrouillé : l'email n'apparaît nulle part dans le HTML (ni texte, ni attribut).
          `
      <tr class="locked-row">
        <td class="num">${total - i}</td>
        <td class="email"><div class="email-cell"><span class="avatar lock" aria-hidden="true">${lockIcon}</span><span class="email-text masked">••••••••@••••••.••</span><a class="locked-chip" href="/billing">Pro</a></div></td>
        <td class="date"><time datetime="${esc(s.created_at)}">${esc(fmtDateFallback(s.created_at))}</time></td>
        <td class="actions">
          <form method="post" action="${base}/subscribers/${s.id}/delete" data-confirm="Retirer cet inscrit verrouillé de la liste ?">
            <button class="icon-btn" type="submit" title="Retirer" aria-label="Retirer cet inscrit verrouillé">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>
            </button>
          </form>
        </td>
      </tr>`
        : `
      <tr data-email="${esc(s.email)}">
        <td class="num">${total - i}</td>
        <td class="email"><div class="email-cell"><span class="avatar" aria-hidden="true">${esc(s.email[0].toUpperCase())}</span><span class="email-text">${esc(s.email)}</span></div></td>
        <td class="date"><time datetime="${esc(s.created_at)}">${esc(fmtDateFallback(s.created_at))}</time></td>
        <td class="actions">
          <form method="post" action="${base}/subscribers/${s.id}/delete" data-confirm="Retirer ${esc(s.email)} de la liste ?">
            <button class="icon-btn" type="submit" title="Retirer" aria-label="Retirer ${esc(s.email)}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>
            </button>
          </form>
        </td>
      </tr>`
    )
    .join('');

  const upsell =
    lockedCount && !pro
      ? `<section class="card upsell">
        <div class="upsell-icon" aria-hidden="true">${lockIcon}</div>
        <div class="upsell-body">
          <h2>${lockedCount} ${plural(lockedCount, 'inscrit verrouillé', 'inscrits verrouillés')} sur cette liste</h2>
          <p>Votre compte a dépassé les ${FREE_LIMIT} inscrits du plan gratuit. Les inscriptions continuent d’arriver, mais leurs emails restent masqués et hors de l’export. Passez en Pro pour tout débloquer.</p>
        </div>
        <a class="btn primary" href="/billing">Débloquer, ${PRO_PRICE_EUR} €/mois</a>
      </section>`
      : '';

  let flash = '';
  if (flags.created) {
    flash = `<section class="card banner">
        <div class="banner-icon" aria-hidden="true">🎉</div>
        <div class="banner-body">
          <h2>Votre liste est en ligne !</h2>
          <p>Partagez le lien public pour recueillir vos premières inscriptions. Vous retrouverez cette liste à tout moment dans <a href="/lists">Mes listes</a>.</p>
          <div class="copy-field">
            <input readonly value="${esc(publicUrl)}" aria-label="Lien public de la liste">
            <button class="btn sm" type="button" data-copy="${esc(publicUrl)}">Copier</button>
          </div>
        </div>
      </section>`;
  } else if (flags.claimed) {
    flash = `<p class="toast" role="status">Liste rattachée à votre compte ✓</p>`;
  } else if (flags.saved) {
    flash = `<p class="toast" role="status">Modifications enregistrées ✓</p>`;
  } else if (flags.removed) {
    flash = `<p class="toast" role="status">Inscrit retiré ✓</p>`;
  } else if (flags.error) {
    flash = `<p class="toast error" role="alert">Le titre ne peut pas être vide.</p>`;
  }

  const body = `
${nav(user, { sticky: true })}
<main class="dash">
  ${flash}
  <a class="back" href="/lists"><span aria-hidden="true">←</span> Mes listes</a>
  ${upsell}
  <section class="dash-head">
    <div>
      <p class="eyebrow">Dashboard</p>
      <h1>${esc(list.title)}</h1>
    </div>
    <div class="copy-field share">
      <span class="share-label">Lien public</span>
      <input readonly value="${esc(publicUrl)}" aria-label="Lien public de la liste">
      <button class="btn primary sm" type="button" data-copy="${esc(publicUrl)}">Copier</button>
      <a class="btn sm" href="/w/${esc(list.slug)}" target="_blank" rel="noopener" title="Ouvrir la page publique" aria-label="Ouvrir la page publique">↗</a>
    </div>
  </section>

  <section class="stats" aria-label="Statistiques">
    <div class="card stat hero-stat">
      <span class="stat-label">Total inscrits</span>
      <strong class="stat-value">${total}</strong>
      <span class="stat-sub" data-stat="since">depuis le lancement</span>
    </div>
    <div class="card stat">
      <span class="stat-label">Aujourd’hui</span>
      <strong class="stat-value" data-stat="today">–</strong>
      <span class="stat-sub" data-stat="today-sub">&nbsp;</span>
    </div>
    <div class="card stat">
      <span class="stat-label">7 derniers jours</span>
      <strong class="stat-value" data-stat="week">–</strong>
      <span class="stat-sub" data-stat="week-sub">&nbsp;</span>
    </div>
  </section>

  <section class="card chart-card">
    <header class="card-head">
      <div>
        <h2>Inscriptions par jour</h2>
        <p class="muted">30 derniers jours</p>
      </div>
      <button class="btn ghost sm" type="button" id="chart-toggle" aria-pressed="false">Voir en tableau</button>
    </header>
    <div class="chart" id="chart" role="img" aria-label="Histogramme des inscriptions par jour sur les 30 derniers jours"></div>
    <div class="chart-table" id="chart-table" hidden></div>
  </section>

  <section class="card subs">
    <header class="card-head">
      <h2>Inscrits <span class="pill">${total}</span></h2>
      <div class="tools">
        ${total ? `<input type="search" id="search" placeholder="Rechercher un email…" aria-label="Rechercher un email">` : ''}
        ${total > lockedCount ? `<a class="btn sm" href="${base}/export.csv" ${lockedCount ? 'title="Les inscrits verrouillés ne sont pas exportés"' : ''}>Exporter CSV${lockedCount ? ` (${total - lockedCount})` : ''}</a>` : ''}
      </div>
    </header>
    ${
      total
        ? `<div class="table-wrap"><table>
        <thead><tr><th class="num">#</th><th>Email</th><th>Inscrit le</th><th class="actions"><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="empty" id="no-match" hidden>Aucun email ne correspond à cette recherche.</p>`
        : `<div class="empty-state">
        <div class="empty-icon" aria-hidden="true">✉️</div>
        <h3>Pas encore d’inscrits</h3>
        <p>Partagez votre lien public pour recevoir vos premières inscriptions.</p>
      </div>`
    }
  </section>

  <section class="settings">
    <form class="card" method="post" action="${base}/edit">
      <h2>Modifier la page</h2>
      <label class="field"><span>Titre</span><input name="title" required maxlength="80" value="${esc(list.title)}"></label>
      <label class="field"><span>Description</span><textarea name="description" rows="4" maxlength="600">${esc(list.description)}</textarea></label>
      <button class="btn primary" type="submit">Enregistrer</button>
    </form>
    <form class="card danger" method="post" action="${base}/delete" data-confirm="Supprimer définitivement cette liste et ses ${total} inscrit(s) ? Cette action est irréversible.">
      <h2>Zone de danger</h2>
      <p class="muted">Supprimer la liste efface la page publique et tous les inscrits. Pensez à exporter le CSV avant.</p>
      <button class="btn danger-btn" type="submit">Supprimer la liste</button>
    </form>
  </section>
</main>
<script type="application/json" id="dash-data">${jsonScript({
    createdAt: list.created_at,
    dates: subscribers.map((s) => s.created_at),
  })}</script>`;
  return layout({ title: `${list.title} · Dashboard`, body, bodyClass: 'page-dash', scripts: ['dashboard.js'] });
}

/* ------------------------------------------------------------- Abonnement */

export function billingPage({ user, usage, notice, stripeEnabled }) {
  const pro = isPro(user);
  const notices = {
    success: ['toast', 'Bienvenue en Pro ! Tous vos inscrits sont débloqués. 🎉'],
    pending: ['toast warn', 'Paiement reçu. L’activation de votre plan Pro est en cours : rechargez la page dans quelques secondes.'],
    cancel: ['toast neutral', 'Paiement annulé : rien n’a été facturé.'],
    error: ['toast error', stripeEnabled ? 'Impossible de joindre le service de paiement pour le moment. Réessayez dans un instant.' : 'Le paiement n’est pas encore configuré sur ce serveur.'],
  };
  const n = notices[notice === 'success' && !pro ? 'pending' : notice];
  const flash = n ? `<p class="${n[0]}" role="status">${esc(n[1])}</p>` : '';

  let status = '';
  if (pro) {
    const end = user.current_period_end ? fmtUnix(user.current_period_end) : null;
    if (user.subscription_status === 'past_due') {
      status = `<p class="sub-status warn"><span class="warn-mark" aria-hidden="true">!</span> Le dernier paiement a échoué. Stripe va réessayer ; mettez à jour votre carte pour garder le plan Pro.</p>`;
    } else if (user.cancel_at_period_end) {
      status = `<p class="sub-status">Abonnement annulé : il reste actif${end ? ` jusqu’au <strong>${esc(end)}</strong>` : ''}, puis vous repasserez au plan gratuit. Vos inscrits actuels resteront accessibles.</p>`;
    } else if (end) {
      status = `<p class="sub-status">Prochain renouvellement le <strong>${esc(end)}</strong>.</p>`;
    }
  }

  const fine = pro
    ? 'Paiement sécurisé par Stripe. Factures, carte bancaire et résiliation se gèrent depuis le portail Stripe.'
    : 'Paiement sécurisé par Stripe. Sans engagement : annulez quand vous voulez, vous gardez le Pro jusqu’à la fin du mois payé.';

  const body = `
${nav(user, { sticky: true })}
<main class="dash billing">
  ${flash}
  <section class="dash-head">
    <div>
      <p class="eyebrow">Compte</p>
      <h1>Abonnement</h1>
    </div>
  </section>
  ${usageMeter(user, usage, { cta: false })}
  ${status}
  ${planCards({ user, stripeEnabled })}
  <p class="fine-print">${fine}</p>
</main>`;
  return layout({ title: 'Abonnement · Waitlist', body, bodyClass: 'page-dash' });
}

/* ------------------------------------------------------------------ 404 */

export function notFound(message = 'Cette page n’existe pas (ou plus).', status = '404') {
  const body = `
${aurora}
<main class="public">
  <article class="card public-card center">
    <p class="big-code">${esc(status)}</p>
    <h1>${status === '404' ? 'Introuvable' : 'Oups'}</h1>
    <p class="desc">${esc(message)}</p>
    <a class="btn primary" href="/">Retour à l’accueil</a>
  </article>
</main>`;
  return layout({ title: 'Introuvable · Waitlist', body, bodyClass: 'page-public' });
}
