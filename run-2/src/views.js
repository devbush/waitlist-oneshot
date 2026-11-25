const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const jsonScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

const logo = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c6cff"/><stop offset="1" stop-color="#e255c8"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#lg)"/><path d="M9 11.5h14M9 16h10M9 20.5h6" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>`;

const aurora = `<div class="aurora" aria-hidden="true"><span></span><span></span><span></span></div>`;

const brand = `<a class="brand" href="/">${logo}<span>Waitlist</span></a>`;

const fmtDateFallback = (iso) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

const plural = (n, one, many) => (n === 1 ? one : many);

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

/* ---------------------------------------------------------------- Accueil */

export function home({ error = '', values = {} } = {}) {
  const body = `
${aurora}
<header class="nav">${brand}</header>
<main class="home">
  <section class="hero">
    <span class="eyebrow"><span class="spark">✦</span> Listes d'attente, sans prise de tête</span>
    <h1>Faites monter l'impatience <em>avant</em> le lancement.</h1>
    <p class="lead">Créez une page d'inscription élégante pour votre projet, partagez le lien, et suivez vos inscrits depuis un dashboard clair.</p>
    <ul class="perks">
      <li><span>1</span> Une page publique prête à partager</li>
      <li><span>2</span> Un formulaire email anti-doublons</li>
      <li><span>3</span> Un dashboard privé avec export CSV</li>
    </ul>
  </section>

  <form class="card create" method="post" action="/create">
    <h2>Nouvelle liste</h2>
    ${error ? `<p class="alert error" role="alert">${esc(error)}</p>` : ''}
    <label class="field">
      <span>Titre du projet</span>
      <input name="title" required maxlength="80" value="${esc(values.title)}" placeholder="Ex. Nebula, l'agenda qui pense pour vous" autofocus>
    </label>
    <label class="field">
      <span>Description <small>optionnelle</small></span>
      <textarea name="description" maxlength="600" rows="4" placeholder="Dites en deux phrases pourquoi on devrait s'inscrire.">${esc(values.description)}</textarea>
    </label>
    <button class="btn primary block" type="submit">Créer ma liste <span aria-hidden="true">→</span></button>
    <p class="hint">Vous obtiendrez un lien public à partager et un lien privé vers votre dashboard.</p>
  </form>

  <section class="my-lists" id="my-lists" hidden>
    <h2>Vos listes <small>sur cet appareil</small></h2>
    <ul></ul>
  </section>
</main>`;
  return layout({ title: 'Waitlist · Créez votre liste d’attente', body, bodyClass: 'page-home', scripts: ['home.js'] });
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

export function dashboard({ list, subscribers, baseUrl, flags }) {
  const publicUrl = `${baseUrl}/w/${list.slug}`;
  const adminUrl = `${baseUrl}/admin/${list.admin_token}`;
  const total = subscribers.length;
  const t = esc(list.admin_token);

  const rows = subscribers
    .map(
      (s, i) => `
      <tr data-email="${esc(s.email)}">
        <td class="num">${total - i}</td>
        <td class="email"><div class="email-cell"><span class="avatar" aria-hidden="true">${esc(s.email[0].toUpperCase())}</span><span class="email-text">${esc(s.email)}</span></div></td>
        <td class="date"><time datetime="${esc(s.created_at)}">${esc(fmtDateFallback(s.created_at))}</time></td>
        <td class="actions">
          <form method="post" action="/admin/${t}/subscribers/${s.id}/delete" data-confirm="Retirer ${esc(s.email)} de la liste ?">
            <button class="icon-btn" type="submit" title="Retirer" aria-label="Retirer ${esc(s.email)}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>
            </button>
          </form>
        </td>
      </tr>`
    )
    .join('');

  let flash = '';
  if (flags.created) {
    flash = `<section class="card banner">
        <div class="banner-icon" aria-hidden="true">🎉</div>
        <div class="banner-body">
          <h2>Votre liste est en ligne !</h2>
          <p>Gardez précieusement l’adresse de cette page : <strong>c’est votre seul accès au dashboard</strong>. Ajoutez-la à vos favoris.</p>
          <div class="copy-field">
            <input readonly value="${esc(adminUrl)}" aria-label="Lien privé du dashboard">
            <button class="btn sm" type="button" data-copy="${esc(adminUrl)}">Copier</button>
          </div>
        </div>
      </section>`;
  } else if (flags.saved) {
    flash = `<p class="toast" role="status">Modifications enregistrées ✓</p>`;
  } else if (flags.removed) {
    flash = `<p class="toast" role="status">Inscrit retiré ✓</p>`;
  } else if (flags.error) {
    flash = `<p class="toast error" role="alert">Le titre ne peut pas être vide.</p>`;
  }

  const body = `
<header class="nav">
  ${brand}
  <a class="btn ghost sm" href="/w/${esc(list.slug)}" target="_blank" rel="noopener">Voir la page publique <span aria-hidden="true">↗</span></a>
</header>
<main class="dash">
  ${flash}
  <section class="dash-head">
    <div>
      <p class="eyebrow">Dashboard</p>
      <h1>${esc(list.title)}</h1>
    </div>
    <div class="copy-field share">
      <span class="share-label">Lien public</span>
      <input readonly value="${esc(publicUrl)}" aria-label="Lien public de la liste">
      <button class="btn primary sm" type="button" data-copy="${esc(publicUrl)}">Copier</button>
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
        ${total ? `<a class="btn sm" href="/admin/${t}/export.csv">Exporter CSV</a>` : ''}
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
    <form class="card" method="post" action="/admin/${t}/edit">
      <h2>Modifier la page</h2>
      <label class="field"><span>Titre</span><input name="title" required maxlength="80" value="${esc(list.title)}"></label>
      <label class="field"><span>Description</span><textarea name="description" rows="4" maxlength="600">${esc(list.description)}</textarea></label>
      <button class="btn primary" type="submit">Enregistrer</button>
    </form>
    <form class="card danger" method="post" action="/admin/${t}/delete" data-confirm="Supprimer définitivement cette liste et ses ${total} inscrit(s) ? Cette action est irréversible.">
      <h2>Zone de danger</h2>
      <p class="muted">Supprimer la liste efface la page publique et tous les inscrits. Pensez à exporter le CSV avant.</p>
      <button class="btn danger-btn" type="submit">Supprimer la liste</button>
    </form>
  </section>
</main>
<script type="application/json" id="dash-data">${jsonScript({
    slug: list.slug,
    title: list.title,
    token: list.admin_token,
    createdAt: list.created_at,
    dates: subscribers.map((s) => s.created_at),
  })}</script>`;
  return layout({ title: `${list.title} · Dashboard`, body, bodyClass: 'page-dash', scripts: ['dashboard.js'] });
}

/* ------------------------------------------------------------------ 404 */

export function notFound(message = 'Cette page n’existe pas (ou plus).') {
  const body = `
${aurora}
<main class="public">
  <article class="card public-card center">
    <p class="big-code">404</p>
    <h1>Introuvable</h1>
    <p class="desc">${esc(message)}</p>
    <a class="btn primary" href="/">Retour à l’accueil</a>
  </article>
</main>`;
  return layout({ title: 'Introuvable · Waitlist', body, bodyClass: 'page-public' });
}
