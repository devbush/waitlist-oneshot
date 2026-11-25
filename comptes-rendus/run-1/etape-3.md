# Run 1, étape 3 : export CSV

- Durée : 0.2 min
- Tours de l'agent : 2
- Coût cumulé de la session, estimé au tarif public de l'API : 7.70 $

## Prompt

```text
Ajoute un export CSV des inscrits.
```

## Réponse de l'agent

Texte brut, non corrigé. Ce que l'agent affirme ici n'est pas vérifié : voir `audits/`.

---

L'export CSV existe déjà, je l'avais ajouté dès la première version. Je n'ai donc rien modifié.

**Où le trouver :** dans le dashboard d'une liste, bouton **« Exporter CSV »** à côté de la recherche, au-dessus du tableau des inscrits (`public/dashboard.html:101`). Il télécharge un fichier `<nom-de-la-liste>-inscrits.csv`.

**Ce que contient le fichier :**
- trois colonnes : `position`, `email` et `date_inscription` (date et heure au format standard ISO, en temps universel) ;
- une ligne par inscrit, du premier au dernier arrivé ;
- un encodage qui s'ouvre directement dans Excel sans casser les accents.

**Protections déjà en place :**
- Seul le propriétaire de la liste peut l'exporter : pour les autres comptes, la liste est introuvable.
- Un email qui commence par `=`, `+`, `-` ou `@` est neutralisé, pour qu'Excel ne l'exécute pas comme une formule.
- En plan gratuit, l'export ne contient que les inscrits visibles (les 100 premiers du compte). En Pro, il contient tout le monde.

Ces comportements sont vérifiés par les tests automatiques (`test/api.test.js` et `test/billing.test.js`).

Si vous pensiez à autre chose, je peux par exemple ajouter :
- **un export de toutes vos listes en un seul fichier**, depuis « Mes listes », avec une colonne pour le nom de la liste ;
- **un séparateur point-virgule**, qu'Excel en français ouvre directement en colonnes (aujourd'hui, il faut parfois passer par « Données → Convertir ») ;
- **des dates à l'heure française**, au lieu du temps universel.

Dites-moi ce qui vous serait utile.
