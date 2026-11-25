# Run 3, étape 4 : parrainage

- Durée : 6.0 min
- Tours de l'agent : 33
- Coût cumulé de la session, estimé au tarif public de l'API : 9.39 $

## Prompt

```text
Ajoute le parrainage : chaque inscrit a un lien, et il monte dans la liste quand quelqu'un s'inscrit avec.
```

## Réponse de l'agent

Texte brut, non corrigé. Ce que l'agent affirme ici n'est pas vérifié : voir `audits/`.

---

Le parrainage est en place : chaque inscrit reçoit un lien personnel, et chaque personne qui s'inscrit avec ce lien le fait **remonter de 5 places**. Les 32 tests passent, et j'ai vérifié tout le parcours dans le navigateur.

## Côté inscrit (page publique)
- **Après l'inscription**, l'écran affiche sa place (« #12 sur 12 »), son nombre d'amis parrainés et son lien, avec un bouton « Copier » et des boutons de partage (WhatsApp, X, LinkedIn, email, et le partage natif du téléphone).
- **Un visiteur arrivé par un lien** voit le badge « 🎁 Un ami vous invite ».
- **De retour sur la page** avec le même navigateur, l'inscrit retrouve sa place à jour et ses filleuls (« Content de vous revoir 👋 »). S'il ressaisit son email, il obtient la même chose.

## Côté créateur (dashboard)
- **Panneau Parrainage** : le nombre d'inscrits venus par un parrain, leur part du total, le nombre de parrains actifs et le top 5 des parrains.
- **Tableau des inscrits** : nouvelles colonnes Rang, Filleuls et Parrain, avec un tri « Plus récents » ou « Ordre de la liste ».
- **Réglage du bonus** : « Places gagnées par filleul » dans « Modifier » (5 par défaut, 0 pour désactiver le bonus).
- **Export CSV** : il est maintenant trié par rang, avec les colonnes filleuls, parrain et lien de parrainage.

## Règles de calcul
- **Classement** : la place vaut l'ordre d'arrivée moins 5 places par filleul. À égalité, le plus ancien passe devant. Par exemple, le 10e inscrit passe 6e avec un filleul, puis 1er avec deux.
- **Codes acceptés** : un code invalide ou venant d'une autre liste est ignoré, et une personne déjà inscrite garde son parrain d'origine.
- **Suppressions** : supprimer un filleul retire le bonus de son parrain. Supprimer un parrain conserve ses filleuls, qui n'ont simplement plus de parrain.
- **Plan Gratuit** : au-delà de 100 inscrits, l'email d'un inscrit verrouillé reste caché partout, y compris dans la colonne Parrain, le top des parrains et le CSV. Je l'ai testé spécifiquement.
- **Listes existantes** : la base est mise à jour automatiquement, et les inscrits déjà présents reçoivent un lien.

## À savoir
- **Triche possible** : les emails ne sont pas vérifiés, donc quelqu'un peut grimper avec de fausses adresses. La limite de 20 inscriptions par IP toutes les 10 minutes freine sans empêcher. Pour l'instant, la parade consiste à surveiller le top des parrains et à supprimer les filleuls suspects. Pour bloquer ça vraiment, il faudrait faire confirmer l'email par un lien, ce qui demande d'ajouter l'envoi d'emails.
- **Pas de notification** : l'app n'envoie toujours aucun email, donc un inscrit ne sait qu'il a gagné des places qu'en revenant sur la page.
