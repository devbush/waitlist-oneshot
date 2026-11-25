# Run 2, étape 2 : plan payant Stripe

- Durée : 8.7 min
- Tours de l'agent : 37
- Coût cumulé de la session, estimé au tarif public de l'API : 7.50 $

## Prompt

```text
Ajoute un plan payant avec Stripe : gratuit jusqu'à 100 inscrits, 9 € par mois en illimité.
```

## Réponse de l'agent

Texte brut, non corrigé. Ce que l'agent affirme ici n'est pas vérifié : voir `audits/`.

---

Le plan Pro est en place : gratuit jusqu'à 100 inscrits, puis 9 € par mois en illimité, payé via Stripe. **Je ne l'ai pas encore testé avec ton vrai compte Stripe**, seulement contre un faux serveur Stripe local.

**Deux choix à valider :**
- **La limite de 100 s'applique au compte entier**, toutes listes confondues. Si elle était par liste, il suffirait de créer une nouvelle liste pour la contourner.
- **Au-delà de 100, les inscriptions ne sont pas bloquées.** Les visiteurs peuvent toujours s'inscrire, donc tu ne perds aucun contact pendant un lancement. Les nouveaux inscrits sont simplement **verrouillés** : leur email est masqué dans le dashboard et n'apparaît pas dans l'export CSV. Le passage en Pro les débloque tous d'un coup.

Si tu préfères bloquer net les inscriptions à 100, c'est un petit changement.

**Ce qui est fait :**
- **Mes listes :** une jauge « 100 / 100, 5 inscrits verrouillés » avec un bouton « Tout débloquer ». Elle passe en orange à partir de 80 %.
- **Dashboard :** un bandeau « N inscrits verrouillés » et les emails masqués. L'adresse n'apparaît nulle part dans la page, même pas dans le code HTML.
- **Page Abonnement (`/billing`) :** les deux plans, le paiement sur la page Stripe, puis le portail Stripe pour changer de carte, récupérer ses factures ou résilier. Elle affiche la date de renouvellement, une annulation programmée et les paiements échoués.
- **Accueil :** une section « Des tarifs simples ».
- **Supprimer des inscrits ne débloque rien.** Sinon, un compte gratuit pourrait exporter 100 emails, les supprimer, et voir apparaître les suivants.
- **Fin d'abonnement :** les inscrits déjà débloqués restent visibles, et seuls les nouveaux au-delà de 100 sont de nouveau verrouillés.

**Les tests :** les 43 vérifications passent. Elles couvrent :
- le quota et l'export ;
- le passage en Pro, avec activation immédiate au retour du paiement ;
- les webhooks (les notifications que Stripe envoie à l'app) : mauvaise signature, rejeu d'un vieil événement, doublons ;
- l'annulation et la fin d'abonnement ;
- la tentative d'activer un compte avec la session de paiement d'un autre ;
- le bouton qui renvoie vers le portail au lieu de créer un second abonnement ;
- Stripe injoignable.

**Ce qu'il te reste à faire** (tout est détaillé dans le README) :
1. Copier `.env.example` en `.env` et y mettre ta clé de test `sk_test_…`.
2. Lancer `stripe listen --forward-to localhost:3000/stripe/webhook`, puis mettre le secret `whsec_…` qu'il affiche dans `.env`.
3. Activer le portail client dans le Dashboard Stripe (*Paramètres → Facturation → Portail client*). Sans ça, « Gérer mon abonnement » ne fonctionnera pas.
4. Tester avec la carte `4242 4242 4242 4242`.

Le prix à 9 €/mois est créé automatiquement chez Stripe au premier paiement. Si tu en as déjà un, indique son identifiant dans `STRIPE_PRICE_ID`.

**À savoir :**
- **TVA :** l'app ne la gère pas, le prix est de 9 € tel quel. Si tu dois la collecter, il faut activer Stripe Tax.
- **Sans clé Stripe :** l'app tourne quand même, et le bouton affiche « Paiement indisponible ».

Si tu veux, je peux faire un vrai essai en mode test avec ta CLI Stripe. Cela créerait un produit, un prix et des clients de test sur ton compte, donc j'attends ton accord.
