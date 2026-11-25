# Run 1, étape 2 : plan payant Stripe

- Durée : 6.7 min
- Tours de l'agent : 55
- Coût cumulé de la session, estimé au tarif public de l'API : 7.57 $

## Prompt

```text
Ajoute un plan payant avec Stripe : gratuit jusqu'à 100 inscrits, 9 € par mois en illimité.
```

## Réponse de l'agent

Texte brut, non corrigé. Ce que l'agent affirme ici n'est pas vérifié : voir `audits/`.

---

Le plan payant est en place : gratuit jusqu'à 100 inscrits, puis Pro à 9 €/mois en illimité via Stripe. Les 11 tests passent, dont 5 nouveaux sur la facturation.

**Je ne l'ai pas encore essayé avec un vrai compte Stripe.** Les tests et ma démo dans Chrome tournent contre un faux Stripe local, qui imite les réponses de l'API et envoie des webhooks signés. Avant de facturer de vrais clients, faites un essai en mode test Stripe (carte `4242 4242 4242 4242`) en suivant le README.

**Deux choix que j'ai faits à votre place**, dites-moi s'ils ne vous conviennent pas :
1. **La limite de 100 vaut pour le compte**, toutes listes confondues. Sinon, il suffirait de créer une nouvelle liste tous les 100 inscrits.
2. **Au-delà de 100, rien n'est bloqué ni perdu.** La page publique continue d'accepter tout le monde. Les nouveaux inscrits sont enregistrés mais masqués dans le dashboard et l'export CSV. Le graphique et les compteurs les comptent quand même, ce qui montre ce qu'on débloque en passant Pro. Bloquer les inscriptions aurait fait perdre des contacts au créateur de la liste.

**Ce qu'on voit dans l'app :**
- **Mes listes** : une carte « plan ».
  - En gratuit, une jauge « 84 / 100 inscrits » qui passe à l'orange vers 80 % et au rouge à la limite, et un bouton « Passer à Pro · 9 €/mois ».
  - En Pro, la date de renouvellement (ou de fin si l'abonnement est résilié) et un bouton « Gérer l'abonnement » qui ouvre le portail Stripe pour changer de carte, voir les factures ou résilier.
- **Dashboard** : un bandeau « 12 inscrits récents masqués » avec un bouton « Débloquer ».
- **Retour du paiement** : l'app affiche « activation en cours… » puis passe en Pro toute seule, en quelques secondes dans ma démo.
- **Accueil** : une section tarifs Gratuit / Pro.

**Sécurité du paiement :** le passage en Pro est décidé uniquement par le webhook Stripe, après vérification de sa signature, et jamais par le retour du navigateur. À chaque événement, l'app relit l'abonnement chez Stripe : un événement en double ou arrivé dans le désordre ne peut pas réactiver un abonnement terminé.

**Ce qu'il vous reste à faire dans Stripe** (le README détaille les étapes) :
1. Créer le produit à 9 €/mois.
2. Ajouter le webhook `/stripe/webhook` avec ses 4 événements.
3. Activer le portail client.
4. Renseigner `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` et `APP_URL`.

Sans ces clés, l'app reste utilisable, mais seulement en gratuit.

**À noter :**
- **TVA** : elle n'est pas gérée. Si vous vendez dans l'UE, il faudra probablement activer Stripe Tax ; c'est une ligne à ajouter, indiquée dans le README.
- **Changer la limite** : la constante `FREE_LIMIT` en haut de `server.js`.

Fichiers modifiés : `server.js` (facturation, webhook, quota), dans `public/` les fichiers `common.js`, `app.*`, `dashboard.*`, `home.html` et `styles.css`, plus `test/billing.test.js` et le README.
