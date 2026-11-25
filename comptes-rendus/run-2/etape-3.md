# Run 2, étape 3 : export CSV

- Durée : 0.2 min
- Tours de l'agent : 2
- Coût cumulé de la session, estimé au tarif public de l'API : 7.65 $

## Prompt

```text
Ajoute un export CSV des inscrits.
```

## Réponse de l'agent

Texte brut, non corrigé. Ce que l'agent affirme ici n'est pas vérifié : voir `audits/`.

---

L'export CSV existe déjà depuis la première version, je n'ai donc rien modifié. Il est dans le dashboard de chaque liste : bouton **« Exporter CSV »** au-dessus du tableau des inscrits (adresse directe : `/lists/<ta-liste>/export.csv`).

Ce qu'il contient :
- **Colonnes :** `email` et `inscrit_le` (date et heure UTC), du plus ancien au plus récent.
- **Fichier :** `inscrits-<ta-liste>.csv`, encodé pour que les accents s'affichent correctement dans Excel.
- **Protection :** une adresse comme `=cmd@…` ne peut pas être exécutée comme une formule à l'ouverture dans Excel ou Sheets.
- **Comptes gratuits au-delà de 100 inscrits :** les inscrits verrouillés ne sont pas exportés, et le bouton indique combien de lignes le fichier contiendra, par exemple « Exporter CSV (100) ».
- **Accès :** seul le propriétaire de la liste peut le télécharger.

**Un point à vérifier si tu ouvres le fichier dans Excel en français :** le fichier sépare les colonnes par des virgules. Excel en français attend des points-virgules, et risque donc de tout mettre dans une seule colonne. Google Sheets, Numbers et les outils d'emailing (Mailchimp, Brevo…) l'importent sans problème. Je ne l'ai pas vérifié sur ton Excel.

Si ce n'est pas ce que tu cherchais, je peux ajouter :
1. **Un export de toutes tes listes en un seul fichier**, avec une colonne « liste », depuis la page Mes listes.
2. **Une version compatible Excel en français**, avec des points-virgules et des dates en heure locale.
3. **D'autres colonnes**, par exemple le rang d'inscription (1er, 2e…).

Lequel veux-tu ?
