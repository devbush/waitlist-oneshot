# Run 3, étape 3 : export CSV

- Durée : 0.3 min
- Tours de l'agent : 2
- Coût cumulé de la session, estimé au tarif public de l'API : 6.87 $

## Prompt

```text
Ajoute un export CSV des inscrits.
```

## Réponse de l'agent

Texte brut, non corrigé. Ce que l'agent affirme ici n'est pas vérifié : voir `audits/`.

---

L'export CSV existe déjà, je n'ai donc rien modifié. Il se trouve dans le dashboard de chaque liste : c'est le bouton **« Export CSV »** en haut à droite, à côté de « Modifier » (`public/dashboard.html:48`, servi par `server.js:631`).

**Contenu du fichier :**
- Un fichier `<slug-de-la-liste>-inscrits.csv` avec trois colonnes : rang, email et date d'inscription.
- Seul le propriétaire de la liste peut le télécharger.
- En plan Gratuit au-delà de 100 inscrits, les inscrits verrouillés n'y figurent pas.
- Les cellules qui commencent par `=`, `+`, `-` ou `@` sont neutralisées, pour qu'Excel ne puisse pas les exécuter comme des formules.

Je l'avais vérifié pendant les tests de la facturation : le nombre de lignes est bon, et les inscrits verrouillés sont bien exclus.

**Un point à vérifier de ton côté :** le fichier utilise la virgule comme séparateur. Google Sheets et Numbers l'ouvrent sans problème, mais **Excel configuré en français attend un point-virgule**. Un double-clic risque donc d'afficher tout dans une seule colonne.

Tu avais peut-être autre chose en tête. Dis-moi ce que tu veux :
1. **Un CSV adapté à Excel en français** (point-virgule et dates lisibles comme « 25/11/2026 14:32 »), à la place du format actuel ou en deuxième option.
2. **Un export global** depuis « Mes listes », avec tous les inscrits de toutes tes listes dans un seul fichier et une colonne « liste ».
3. **Un export des seuls résultats filtrés**, c'est-à-dire ceux de la recherche en cours dans le dashboard.
