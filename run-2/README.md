# Waitlist

Des listes d'attente en quelques secondes. Créez un compte, créez une liste pour votre projet : vous obtenez une page publique (titre, description, formulaire email) et un dashboard avec les inscrits, le total et un graphique des inscriptions. Chaque compte ne voit que ses propres listes.

Plan **Gratuit** jusqu’à 100 inscrits, plan **Pro** à 9 €/mois pour des inscrits illimités (paiement Stripe).

Aucune dépendance : Node.js ≥ 22.13 suffit (serveur HTTP natif + SQLite intégré `node:sqlite`).

## Lancer

```bash
npm start          # http://localhost:3000
npm run dev        # avec rechargement automatique
```

Les variables d’environnement peuvent être mises dans un fichier `.env` (modèle : `.env.example`), chargé automatiquement par `npm start` / `npm run dev`.

| Variable   | Défaut               | Rôle                                                                    |
|------------|----------------------|-------------------------------------------------------------------------|
| `PORT`     | `3000`               | Port HTTP                                                               |
| `DB_PATH`  | `data/waitlist.db`   | Fichier SQLite                                                          |
| `BASE_URL` | déduit de la requête | URL publique (liens affichés, retours Stripe, cookie `Secure` si elle commence par `https:`) |
| `TRUST_PROXY` | — | Mettre `1` derrière un reverse proxy (Nginx, Render, Fly…) pour lire l’IP réelle dans `X-Forwarded-For`. **Indispensable en production derrière un proxy** : sinon tous les visiteurs ont la même IP, les parrainages ne comptent plus et la limite d’inscriptions s’applique à tout le monde à la fois |
| `STRIPE_SECRET_KEY` | — | Clé secrète Stripe. Sans elle, le bouton « Passer en Pro » est désactivé |
| `STRIPE_WEBHOOK_SECRET` | — | Secret de signature du webhook (`whsec_…`) |
| `STRIPE_PRICE_ID` | — | Prix à utiliser. Par défaut : un prix « Waitlist Pro » à 9 €/mois est créé automatiquement (lookup key `waitlist_pro_monthly`) |

## Pages

| URL | Accès | Rôle |
|---|---|---|
| `/` | public | Présentation (redirige vers `/lists` si connecté) |
| `/signup`, `/login` | public | Création de compte, connexion |
| `/lists` | connecté | Mes listes (stats rapides) + création d'une liste |
| `/lists/<slug>` | propriétaire | Dashboard : total, aujourd'hui, 7 jours, histogramme 30 jours, recherche, export CSV, édition, suppression |
| `/billing` | connecté | Abonnement : quota utilisé, passage en Pro (Stripe Checkout), gestion via le portail client Stripe |
| `/stripe/webhook` | Stripe | Webhook (authentifié par signature) |
| `/w/<slug>` | public | Page d'inscription à partager (fonctionne aussi sans JavaScript) |

Une liste appartenant à un autre compte renvoie un 404, ce qui ne révèle même pas qu'elle existe.

## Parrainage

Après son inscription, chaque inscrit voit **sa position** dans la liste et reçoit **un lien de parrainage** (`/w/<liste>?ref=<code>`) avec des boutons Copier et Partager.

- **Classement** : ordre d’inscription, avec **5 places gagnées par ami parrainé** (constante `REFERRAL_BOOST` dans `src/plans.js`). À égalité, le plus ancien inscrit passe devant.
- **Retrouver sa position** : ré-entrer son email sur la page publique. Le lien de parrainage est public et ne permet pas de voir la position de son propriétaire.
- **Anti-triche** : un parrainage ne compte que s’il vient d’une autre IP que celle du parrain, et plusieurs filleuls depuis une même IP ne comptent qu’une fois. Les IP ne sont jamais stockées en clair (HMAC avec un secret propre à l’installation). Sans confirmation d’email, quelqu’un qui dispose de plusieurs connexions peut encore tricher : le propriétaire peut retirer les inscrits suspects, et le parrain perd alors les places correspondantes.
- **Dashboard** : les inscrits sont classés par position, avec le nombre de parrainages de chacun et le nombre d’inscrits arrivés via un lien. L’export CSV suit le même ordre (`position,email,parrainages,inscrit_le`).

## Plans

- **Gratuit** : 100 inscrits par compte, toutes listes confondues.
- **Pro (9 €/mois)** : illimité.

Au-delà de 100 inscrits sur un compte gratuit, **les inscriptions continuent d’être acceptées** (aucun contact perdu pendant un lancement), mais les nouveaux inscrits sont **verrouillés** : leur email est masqué dans le dashboard et exclu de l’export CSV. Le passage en Pro les débloque tous immédiatement.

Le verrouillage est décidé à l’inscription et ne change plus ensuite : supprimer des inscrits visibles ne révèle pas les emails verrouillés. Si un abonnement Pro se termine, les inscrits déjà débloqués restent accessibles, mais les nouveaux au-delà de 100 sont de nouveau verrouillés.

## Configurer Stripe

1. **Clés** : copiez `.env.example` en `.env` et renseignez `STRIPE_SECRET_KEY` (clé de test `sk_test_…` pour commencer).
2. **Webhooks en local** : avec la CLI Stripe, lancez
   ```bash
   stripe listen --forward-to localhost:3000/stripe/webhook
   ```
   puis copiez le secret `whsec_…` affiché dans `STRIPE_WEBHOOK_SECRET` et redémarrez l’app.
3. **Portail client** : dans le Dashboard Stripe, *Paramètres → Facturation → Portail client*, enregistrez une configuration (une fois en mode test, une fois en mode live). C’est le portail qui permet de changer de carte, télécharger les factures et résilier.
4. **Tester** : « Passer en Pro » avec la carte `4242 4242 4242 4242`, une date future et n’importe quel CVC.
5. **Production** : définissez `BASE_URL`, utilisez la clé live et créez un endpoint webhook `https://votre-domaine/stripe/webhook` abonné à :
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`.

Fonctionnement : à chaque événement, l’app relit l’abonnement chez Stripe (source de vérité) au lieu de se fier au contenu de l’événement, ce qui la rend insensible aux doublons et au désordre d’arrivée. Au retour de Checkout, l’abonnement est aussi synchronisé immédiatement, sans attendre le webhook. Un compte est Pro tant que l’abonnement est `active`, `trialing` ou `past_due` (pendant que Stripe relance un paiement échoué).

TVA : le prix est de 9 € tel quel ; activez Stripe Tax si vous devez collecter la TVA.

## Comptes & sécurité

- Mots de passe hachés avec **scrypt** (sel aléatoire, comparaison à temps constant, 8 caractères minimum).
- Sessions de 30 jours : cookie `HttpOnly`, `SameSite=Lax` (et `Secure` en HTTPS). Seul le hash SHA-256 du jeton est stocké en base. La déconnexion invalide la session côté serveur.
- Anti-CSRF : les formulaires authentifiés doivent provenir de la même origine (en-tête `Origin`/`Referer`).
- Anti force brute : 10 échecs de connexion/inscription par IP sur 15 minutes. Les connexions réussies ne comptent pas.
- Échappement HTML systématique, CSP stricte (aucun script ni style inline), `Referrer-Policy: no-referrer`.
- Pages publiques : champ « pot de miel » + 8 inscriptions/minute par IP.
- Export CSV protégé contre l'injection de formules (Excel/Sheets).
- Webhooks Stripe : signature HMAC vérifiée à temps constant, rejet des événements de plus de 5 minutes (rejeu). Un compte ne peut pas s’activer avec la session Checkout d’un autre.

Pas encore inclus : réinitialisation du mot de passe par email (il faudrait un service d'envoi d'emails).

## Migration depuis la version sans comptes

Les listes créées avant l'ajout des comptes n'ont pas de propriétaire. Pour en récupérer une, ouvrez son ancien lien secret `/admin/<jeton>` : on vous demande de vous connecter (ou de créer un compte), puis la liste est rattachée à votre compte. Le lien ne fonctionne qu'une fois : une liste déjà rattachée ne peut plus être revendiquée par un autre compte.
