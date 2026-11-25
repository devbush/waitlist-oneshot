# Waitlist

Créez des listes d'attente pour vos projets : chaque liste a une page publique (titre, description, formulaire email), et votre compte donne accès à un dashboard pour suivre les inscrits.

## Lancer

Requiert **Node.js ≥ 22.13** (utilise le SQLite intégré à Node — aucune dépendance à installer).

```bash
npm start          # http://localhost:3000
npm run dev        # avec rechargement automatique
```

## Pages

| URL | Accès | Rôle |
|---|---|---|
| `/` | public | Présentation (redirige vers `/app` si connecté) |
| `/signup`, `/login` | public | Création de compte, connexion |
| `/app` | connecté | Mes listes (total et inscrits de la semaine par liste), création |
| `/app/billing` | connecté | Abonnement : utilisation, passage à Pro, gestion |
| `/app/lists/<slug>` | propriétaire | Dashboard : stats, graphique 30 jours, recherche, suppression d'inscrits, export CSV, modification, suppression de la liste |
| `/w/<slug>` | public | Page d'inscription à partager |

Chaque compte ne voit et ne modifie **que ses propres listes** : une liste d'un autre compte répond « introuvable » (404), aussi bien dans les pages que dans l'API.

## Comptes

- Email + mot de passe (8 caractères minimum), hachés avec **scrypt** (sel aléatoire par compte).
- Session par cookie `HttpOnly`, `SameSite=Lax`, valable 30 jours ; seul un hash SHA-256 du jeton est stocké en base. `Secure` est ajouté automatiquement en HTTPS.
- La déconnexion invalide la session côté serveur.

### Listes créées avant les comptes

Elles n'ont pas de propriétaire. Elles sont rattachées au premier compte qui :
- ouvre leur ancien lien secret `/d/<jeton>` une fois connecté ;
- ou se connecte depuis le navigateur qui les avait créées (les jetons mémorisés localement sont rattachés automatiquement).

## Plans et paiement (Stripe)

| Plan | Prix | Inscrits |
|---|---|---|
| Gratuit | 0 € | 100 inscrits visibles par compte (toutes listes confondues) |
| Pro | 9 €/mois | Illimité |

**Au-delà de 100 inscrits en plan Gratuit, rien n'est perdu** : les pages publiques continuent d'accepter les inscriptions, mais les plus récentes sont *verrouillées* (emails masqués dans le dashboard, absents de l'API et de l'export CSV). Le passage à Pro les débloque immédiatement ; un retour au plan Gratuit les reverrouille.

Pages : `/app/billing` (utilisation, plan, passage à Pro, gestion de l'abonnement). Tarifs affichés sur la page d'accueil.

### Mise en place

1. Dans le dashboard Stripe, créez un produit « Waitlist Pro » avec un **prix récurrent de 9 € / mois** et notez son identifiant `price_…`.
2. Activez le **portail client** (Paramètres → Billing → Customer portal) : il sert à changer de carte, voir les factures et résilier.
3. Créez un **webhook** vers `https://votre-domaine/api/stripe/webhook` avec les événements :
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
   Notez son secret `whsec_…`.
4. Lancez le serveur avec :

```bash
STRIPE_SECRET_KEY=sk_live_… STRIPE_PRICE_ID=price_… STRIPE_WEBHOOK_SECRET=whsec_… APP_URL=https://votre-domaine npm start
```

En local, utilisez les clés de test (`sk_test_…`) et la Stripe CLI pour relayer les webhooks :
`stripe listen --forward-to localhost:3000/api/stripe/webhook` (elle affiche le `whsec_…` à utiliser).

**Sans `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID`, les plans sont désactivés et tous les comptes sont illimités.**

### Fonctionnement

- Le paiement passe par **Stripe Checkout** (page hébergée par Stripe : aucune donnée bancaire ne transite par le serveur).
- Au retour de Checkout, l'abonnement est activé immédiatement (vérification de la session auprès de Stripe) ; les **webhooks signés** synchronisent ensuite renouvellements, échecs de paiement et résiliations. À chaque événement, l'abonnement est relu depuis l'API Stripe, ce qui rend l'ordre de livraison des webhooks sans importance.
- Statuts donnant accès à Pro : `active`, `trialing`, `past_due` (Stripe retente le paiement ; le compte repasse en Gratuit si l'abonnement finit annulé).
- Un client Stripe est créé une seule fois par compte et réutilisé.

## Configuration

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `3000` | Port HTTP |
| `DB_PATH` | `./data/waitlist.db` | Fichier SQLite (le schéma est migré automatiquement) |
| `TRUST_PROXY` | — | Mettre `1` derrière un reverse proxy : IP réelle (limites de débit) et détection HTTPS (cookie `Secure`) |
| `NODE_ENV` | — | `production` met les templates HTML en cache mémoire |
| `STRIPE_SECRET_KEY` | — | Clé secrète Stripe (`sk_test_…` / `sk_live_…`). Active les plans |
| `STRIPE_PRICE_ID` | — | Identifiant du prix Pro (`price_…`, 9 €/mois) |
| `STRIPE_WEBHOOK_SECRET` | — | Secret de signature du webhook (`whsec_…`) |
| `APP_URL` | déduit de la requête | URL publique, utilisée pour les retours depuis Stripe (recommandé en production) |

## Protections incluses

- Mots de passe hachés (scrypt), comparaison à temps constant, même temps de réponse pour un email inconnu.
- Limites de débit : connexion (10 essais / 15 min par email, 30 par IP), création de compte (10 / h par IP), inscriptions publiques (20 / 10 min par IP).
- Anti-CSRF : cookie `SameSite=Lax` + vérification de l'en-tête `Origin` sur toute requête qui modifie des données.
- Redirection après connexion limitée aux chemins internes (pas de redirection ouverte).
- Échappement HTML de tout contenu utilisateur, Content-Security-Policy stricte, pot de miel anti-bots, protection contre l'injection de formules dans l'export CSV.

## Non inclus

Pas de réinitialisation de mot de passe par email ni de vérification d'email : l'app n'envoie aucun email. Un compte qui oublie son mot de passe doit être réinitialisé à la main en base.
