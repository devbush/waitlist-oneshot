# Waitlist

Une petite app pour créer des listes d’attente. Chaque utilisateur a un compte. Il y crée des listes, et chaque liste a une **page publique** (titre, description, formulaire email). Un **dashboard privé** affiche les inscrits et leur total. Chacun ne voit que ses propres listes.

L’app n’a aucune dépendance : Node.js ≥ 22.13 et le module SQLite intégré (`node:sqlite`) suffisent.

## Démarrer

```bash
npm start          # http://localhost:3000
npm run dev        # redémarre automatiquement quand le code change
npm test           # tests d’intégration (comptes, isolation, facturation)
```

Variables d’environnement :

| Variable      | Défaut             | Rôle                                                                          |
|---------------|--------------------|-------------------------------------------------------------------------------|
| `PORT`        | `3000`             | Port HTTP                                                                     |
| `DB_PATH`     | `data/waitlist.db` | Fichier SQLite                                                                |
| `TRUST_PROXY` | —                  | `1` derrière un reverse proxy : l’IP est lue dans `X-Forwarded-For`, et le cookie passe en `Secure` si `X-Forwarded-Proto` vaut `https` |
| `APP_URL`     | URL de la requête  | URL publique de l’app (ex. `https://waitlist.exemple.fr`), utilisée pour les retours depuis Stripe. **À définir en production.** |
| `STRIPE_SECRET_KEY`     | — | Clé secrète Stripe (`sk_test_…` ou `sk_live_…`) |
| `STRIPE_PRICE_ID`       | — | Identifiant du prix Pro à 9 €/mois (`price_…`) |
| `STRIPE_WEBHOOK_SECRET` | — | Secret de signature du webhook (`whsec_…`) |

Sans ces trois variables Stripe, l’app fonctionne normalement mais uniquement en plan gratuit, et les boutons de paiement sont remplacés par un message.

## Plans

| Plan    | Prix       | Inscrits visibles                                         |
|---------|------------|-----------------------------------------------------------|
| Gratuit | 0 €        | Les 100 premiers inscrits du compte, toutes listes confondues |
| Pro     | 9 €/mois   | Illimité                                                  |

En plan gratuit, **aucune inscription n’est refusée ni perdue**. Au-delà de 100, les nouveaux inscrits sont enregistrés mais masqués dans le dashboard et l’export CSV. Le graphique et les compteurs les incluent quand même. Dès le passage en Pro, tout le monde devient visible. Si l’abonnement se termine, les inscrits au-delà de 100 sont de nouveau masqués, mais rien n’est supprimé.

La limite se règle avec `FREE_LIMIT` en haut de `server.js`.

## Configurer Stripe

1. **Créer le produit** : dans le dashboard Stripe, *Catalogue de produits → Ajouter un produit* « Waitlist Pro », avec un prix récurrent de 9 € par mois. Copiez l’identifiant du prix (`price_…`) dans `STRIPE_PRICE_ID`.
2. **Clé API** : *Développeurs → Clés API*. Copiez la clé secrète dans `STRIPE_SECRET_KEY`.
3. **Webhook** : *Développeurs → Webhooks → Ajouter un endpoint*, avec l’URL `https://<votre-domaine>/stripe/webhook` et ces événements :
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

   Copiez le secret de signature dans `STRIPE_WEBHOOK_SECRET`.
4. **Portail client** : *Paramètres → Facturation → Portail client*. Activez la résiliation et la mise à jour du moyen de paiement, puis enregistrez. Le bouton « Gérer l’abonnement » ouvre ce portail.

En local, la [CLI Stripe](https://docs.stripe.com/stripe-cli) relaie les webhooks vers votre machine :

```bash
stripe listen --forward-to localhost:3000/stripe/webhook   # affiche le whsec_… à utiliser
```

Carte de test : `4242 4242 4242 4242`, n’importe quelle date future, n’importe quel CVC.

**Comment ça marche.** Le bouton « Passer à Pro » crée une session Stripe Checkout, et le paiement se fait chez Stripe. Le passage en Pro est décidé uniquement par le webhook, après vérification de sa signature, et jamais par le retour du navigateur. À chaque événement, l’app relit l’abonnement auprès de Stripe : les doublons et les événements arrivés dans le désordre n’ont donc pas d’effet. Les statuts `active`, `trialing` et `past_due` donnent accès au Pro. `past_due` laisse le temps à Stripe de retenter le paiement.

**TVA.** Le prix est encaissé tel quel. Si vous devez facturer la TVA (ventes dans l’UE), activez Stripe Tax et ajoutez `automatic_tax[enabled]=true` à la création de la session Checkout dans `createCheckout()`.

## Pages

| URL                 | Accès     | Contenu                                                                 |
|---------------------|-----------|-------------------------------------------------------------------------|
| `/`                 | public    | Présentation (redirige vers `/app` si vous êtes connecté)               |
| `/signup`, `/login` | public    | Création de compte, connexion                                           |
| `/app`              | connecté  | Mes listes, et création d’une liste avec aperçu en direct               |
| `/app/lists/<slug>` | connecté  | Dashboard : total, aujourd’hui, 7 jours, graphique, inscrits, CSV, réglages |
| `/w/<slug>`         | public    | Page d’inscription à la liste (fonctionne même sans JavaScript)         |

## Comptes et sécurité

- **Mots de passe** : 8 caractères minimum, hachés avec scrypt et un sel aléatoire. Le serveur ne garde jamais le mot de passe en clair.
- **Sessions** : un jeton aléatoire de 256 bits, stocké dans un cookie `HttpOnly; SameSite=Lax`. La base ne garde que son empreinte SHA-256. Une session dure 30 jours et se prolonge tant qu’elle sert. La déconnexion la supprime côté serveur.
- **Isolation** : chaque requête sur une liste vérifie qu’elle appartient à l’utilisateur connecté. Sinon, la réponse est un 404, ce qui ne révèle même pas que la liste existe.
- **CSRF** : en plus de `SameSite=Lax`, le serveur refuse toute requête qui modifie des données si son en-tête `Origin` vient d’un autre site.
- **Anti-abus** : la connexion est limitée par IP et par email, de même que la création de comptes et les inscriptions publiques. Un champ pot de miel filtre les robots.
- **Contenu** : tout le contenu est échappé, la CSP est stricte, les iframes sont interdites, et l’export CSV neutralise les injections de formules.

## Mise à jour depuis la version sans comptes

Au premier démarrage, une ancienne base est migrée automatiquement. Les listes déjà créées gardent leur page publique et leurs inscrits, mais n’appartiennent à aucun compte : elles n’apparaissent donc dans aucun dashboard. Les anciens liens `/admin/<clé>` ne fonctionnent plus.

## Limites actuelles

- Pas de « mot de passe oublié » ni de vérification de l’email : il faudrait un service d’envoi d’emails.
- Pas encore de changement de mot de passe ni de suppression de compte depuis l’interface.
- Pas de facture PDF envoyée par l’app : Stripe peut envoyer les reçus (*Paramètres → Emails clients*).
