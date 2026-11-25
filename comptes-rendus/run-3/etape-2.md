# Run 3, étape 2 : plan payant Stripe

- Durée : 6.9 min
- Tours de l'agent : 38
- Coût cumulé de la session, estimé au tarif public de l'API : 6.73 $

## Prompt

```text
Ajoute un plan payant avec Stripe : gratuit jusqu'à 100 inscrits, 9 € par mois en illimité.
```

## Réponse de l'agent

Texte brut, non corrigé. Ce que l'agent affirme ici n'est pas vérifié : voir `audits/`.

---

Le plan payant est en place : **Gratuit jusqu'à 100 inscrits, Pro à 9 €/mois en illimité**, avec un paiement par Stripe. Je ne l'ai testé que contre un faux Stripe local, pas contre le vrai Stripe, faute de clés.

**⚠️ Un incident d'abord :** pendant les tests, j'ai arrêté par erreur un serveur Node qui tournait sur le port 3123. C'était le serveur du projet voisin `oneshot-waitlist/run-1`, pas le mien. Ma commande de nettoyage visait le port au lieu du processus que j'avais lancé. Si tu utilisais ce serveur, il faut le relancer. Pour la suite, je n'arrête plus que les processus que j'ai démarrés moi-même, et j'ai testé sur d'autres ports.

## Deux choix à valider
1. **La limite de 100 compte par compte, toutes listes confondues.** Une limite par liste se contournerait en créant plusieurs listes.
2. **Au-delà de 100, les inscriptions continuent mais restent verrouillées.** Les pages publiques acceptent toujours les visiteurs. Les inscrits en trop sont enregistrés, mais leurs emails restent cachés dans le dashboard et absents de l'export, jusqu'au passage en Pro qui les débloque tous. Tu ne perds donc aucun lead, et c'est plus incitatif que de bloquer le formulaire. Si tu préfères bloquer à 100, c'est un petit changement.

## Ce qui a été ajouté
- **Landing** : une section tarifs avec les deux formules.
- **Mes listes** : un bandeau avec une jauge (« 87 / 100 inscrits », puis « 12 inscrits verrouillés » en orange) et un bouton « Passer à Pro ». Chaque carte de liste indique aussi son nombre de verrouillés.
- **Dashboard** : les inscrits verrouillés apparaissent avec un cadenas et sans leur email. Ces emails ne sont jamais envoyés au navigateur.
- **Page Abonnement (`/app/billing`)** : l'utilisation, le plan actuel, le bouton « Passer à Pro » qui ouvre la page de paiement Stripe, et « Gérer mon abonnement » (carte, factures, résiliation sur le portail Stripe).
- **En-tête** : une pastille Gratuit / Pro.

## Ce que j'ai testé
J'ai simulé Stripe en local, avec de vrais webhooks signés, puis contrôlé chaque écran par capture.
- **Sans Stripe configuré** : les plans sont désactivés et tout le monde est illimité.
- **Quota** : avec 105 inscrits, les 5 plus récents sont verrouillés, sur plusieurs listes. Ils sont masqués dans l'API et absents de l'export CSV.
- **Paiement** : le paiement active Pro dès le retour sur le site, sans attendre le webhook. Un client Stripe n'est créé qu'une fois par compte, et quelqu'un d'autre ne peut pas réutiliser la session de paiement d'un utilisateur.
- **Webhooks** :
  - une signature invalide est rejetée ;
  - une résiliation en fin de période est bien prise en compte ;
  - un paiement en retard garde l'accès Pro le temps que Stripe retente ;
  - un abonnement supprimé fait revenir au plan Gratuit et reverrouille les inscrits ;
  - un webhook en retard d'un ancien abonnement n'écrase pas l'abonnement actif.
- **Navigateur** : de « Passer à Pro » jusqu'au retour, avec l'écran « Bienvenue dans Pro 🎉 ».

## Pour le brancher sur ton compte Stripe
Il faut créer un prix récurrent à 9 €/mois, activer le portail client et déclarer le webhook `/api/stripe/webhook` avec 4 événements. Ensuite, lance le serveur avec les variables `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` et `APP_URL`. Le README détaille chaque étape, y compris le test en local avec `stripe listen`.

## Non inclus
- **TVA et facturation** : la TVA, les mentions légales sur les factures et la facturation annuelle ne sont pas gérées. Stripe Tax peut s'en charger.
- **Emails** : l'app n'envoie toujours aucun email, donc pas d'alerte « vous approchez de la limite ».
