# Run 1, étape 4 : parrainage

- Durée : 5.6 min
- Tours de l'agent : 53
- Coût cumulé de la session, estimé au tarif public de l'API : 10.21 $

## Prompt

```text
Ajoute le parrainage : chaque inscrit a un lien, et il monte dans la liste quand quelqu'un s'inscrit avec.
```

## Réponse de l'agent

Texte brut, non corrigé. Ce que l'agent affirme ici n'est pas vérifié : voir `audits/`.

---

Le parrainage est en place : chaque inscrit reçoit un lien personnel et gagne des places quand quelqu'un s'inscrit avec. Les 16 tests passent, dont 5 nouveaux sur le parrainage, et j'ai vérifié le parcours dans Chrome, sur ordinateur et sur mobile.

**La règle que j'ai choisie** (modifiable via `REFERRAL_BOOST` en haut de `server.js`) : **chaque filleul fait gagner 5 places à son parrain.** Le rang suit l'ordre d'arrivée, moins 5 places par filleul. Dans la démo, Léa arrive 20e, a 2 filleuls et passe 10e. Ne comptent que les nouvelles inscriptions sur la même liste : se réinscrire avec son propre lien, ou réinscrire une adresse déjà présente, ne rapporte rien.

**Pour l'inscrit :**
- Après l'inscription, la page affiche sa place, « Passez devant : +5 places par ami inscrit », son lien personnel avec un bouton Copier, et des boutons de partage : WhatsApp, X, LinkedIn, email, et le partage natif sur mobile.
- Quelqu'un qui arrive par un lien voit « Un ami vous a invité·e ».
- En revenant plus tard sur la page, l'inscrit retrouve directement sa place et son nombre de filleuls, sur le même navigateur.
- Ça marche aussi sans JavaScript.

**Pour vous, dans le dashboard :**
- Une colonne « Parrainages », la mention « parrainé·e par … » sous chaque filleul, et un sélecteur « Récents / Classement ».
- L'export CSV est trié par classement et contient pour chacun : son nombre de filleuls, son parrain et son lien de parrainage. Vous pouvez donc écrire à chacun avec son propre lien.
- Supprimer un faux filleul retire aussitôt les places gagnées par son parrain.

Les inscrits déjà présents reçoivent automatiquement un code au démarrage ; je l'ai vérifié sur une base de la version précédente.

**Points à connaître :**
- **La triche reste possible.** Les adresses email ne sont pas vérifiées, donc quelqu'un peut gonfler son rang avec de fausses adresses. La limite d'inscriptions par IP freine, mais ne bloque pas. Si l'accès anticipé a de la valeur, il faudrait une confirmation par email, ce qui suppose un service d'envoi.
- **Le code de parrainage est aussi la clé du statut.** Quelqu'un qui retape l'adresse d'un inscrit récupère son lien et peut voir son rang (jamais son email). Il ne peut rien lui voler : les places gagnées iraient toujours au vrai parrain.
- **Le plan gratuit n'est pas affecté.** Les 100 inscrits visibles restent les 100 premiers *arrivés*, pas les 100 premiers du classement.
- **Pas d'option pour désactiver le parrainage** : il est actif sur toutes les listes. Je peux ajouter un interrupteur par liste si besoin.

Fichiers modifiés : `server.js`, `public/waitlist.js`, les fichiers `dashboard.*`, `styles.css`, le nouveau `test/referral.test.js` et le README.
