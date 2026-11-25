// Page publique : inscription, parrainage et suivi de sa place.
const form = document.getElementById('join-form');
const msg = document.getElementById('join-msg');
const $ = (id) => document.getElementById(id);
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const slug = form.dataset.slug;
const title = form.dataset.title;
const STORE_KEY = `waitlist:me:${slug}`; // code de parrainage de l'inscrit, sur cet appareil
const refFromUrl = (new URLSearchParams(location.search).get('ref') || '').slice(0, 32);
const fmt = (n) => n.toLocaleString('fr-FR');
const plural = (n, one, many) => (n > 1 ? many : one);

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function remember(code) { try { localStorage.setItem(STORE_KEY, code); } catch { /* navigation privée */ } }
function remembered() { try { return localStorage.getItem(STORE_KEY); } catch { return null; } }
function forget() { try { localStorage.removeItem(STORE_KEY); } catch { /* idem */ } }

// Affiche l'écran « inscrit » : place, filleuls, lien de parrainage et boutons de partage.
function showStatus(status, { already = false, returning = false } = {}) {
  if (already) {
    $('success-title').textContent = 'Vous êtes déjà inscrit·e !';
    $('success-text').textContent = 'Votre place est gardée au chaud. Partagez votre lien pour gagner des places.';
  } else if (returning) {
    $('success-title').textContent = 'Content de vous revoir 👋';
    $('success-text').textContent = 'Voici où vous en êtes dans la liste.';
  }

  $('position-n').textContent = `#${fmt(status.position)}`;
  $('position-of').textContent = `sur ${fmt(status.total)}`;
  $('ref-count').textContent = fmt(status.referrals);
  $('ref-gain').textContent = status.boost > 0 && status.referrals > 0
    ? `+${fmt(status.referrals * status.boost)} places gagnées`
    : '';

  const link = `${location.origin}/w/${slug}?ref=${encodeURIComponent(status.ref_code)}`;
  $('ref-url').textContent = link;
  if (status.boost > 0) {
    $('referral-title').textContent = 'Montez dans la liste 🚀';
    $('referral-text').textContent = `Chaque ami qui s'inscrit avec votre lien vous fait gagner ${fmt(status.boost)} ${plural(status.boost, 'place', 'places')}.`;
  } else {
    $('referral-title').textContent = 'Invitez vos amis';
    $('referral-text').textContent = 'Partagez votre lien personnel avec les personnes que ça pourrait intéresser.';
  }

  const text = `Je viens de rejoindre la liste d'attente de ${title} — inscris-toi aussi :`;
  $('share-wa').href = `https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`;
  $('share-x').href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`;
  $('share-li').href = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`;
  $('share-mail').href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${text}\n${link}`)}`;
  if (navigator.share) {
    const btn = $('share-native');
    btn.hidden = false;
    btn.onclick = () => navigator.share({ title, text, url: link }).catch(() => {});
  }

  $('join-view').classList.add('hidden');
  $('success-view').classList.remove('hidden');
}

$('copy-ref').addEventListener('click', async () => {
  const link = $('ref-url').textContent;
  try { await navigator.clipboard.writeText(link); toast('Lien copié ✨'); }
  catch { prompt('Copiez votre lien :', link); }
});

$('not-me').addEventListener('click', () => {
  forget();
  $('success-view').classList.add('hidden');
  $('join-view').classList.remove('hidden');
  form.reset();
  form.email.focus();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = form.querySelector('button');
  const email = form.email.value.trim();
  msg.textContent = '';
  if (!EMAIL_RE.test(email)) {
    msg.textContent = 'Entrez une adresse email valide.';
    form.email.focus();
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Inscription…';
  try {
    const res = await fetch(`/api/w/${encodeURIComponent(slug)}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, website: form.website.value, ref: refFromUrl }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Une erreur est survenue.');
    if (!data.ref_code) { // filtré par l'anti-bot : on affiche simplement un succès
      document.querySelector('.status-row').classList.add('hidden');
      $('referral').classList.add('hidden');
      $('join-view').classList.add('hidden');
      $('success-view').classList.remove('hidden');
      return;
    }
    remember(data.ref_code);
    showStatus(data, { already: data.already });
  } catch (ex) {
    msg.textContent = ex.message;
    btn.disabled = false;
    btn.textContent = 'Rejoindre la liste';
  }
});

// Au chargement : arrivée via un lien de parrainage, ou retour d'un inscrit sur cet appareil.
(async () => {
  const code = remembered();
  if (code) {
    try {
      const res = await fetch(`/api/w/${encodeURIComponent(slug)}/status?code=${encodeURIComponent(code)}`);
      if (res.ok) return showStatus(await res.json(), { returning: true });
      if (res.status === 404) forget(); // inscription supprimée par le créateur
    } catch { /* hors ligne : on affiche le formulaire */ }
  }
  if (refFromUrl) {
    $('eyebrow').innerHTML = '<span class="dot"></span>🎁 Un ami vous invite';
  }
})();
