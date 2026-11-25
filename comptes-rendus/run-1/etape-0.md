# Run 1, étape 0 : one-shot

- Durée : 11.5 min
- Tours de l'agent : 43
- Coût cumulé de la session, estimé au tarif public de l'API : 2.24 $

## Prompt

```text
Construis-moi une app de listes d'attente. Je crée une liste pour mon projet, ça me donne une page publique avec un titre, une description et un formulaire email. Les gens s'inscrivent, et moi je vois les inscrits et le total dans un dashboard. Fais un truc joli.
```

## Réponse de l'agent

Texte brut, non corrigé. Ce que l'agent affirme ici n'est pas vérifié : voir `audits/`.

---

L'app de listes d'attente est prête. Lancez `npm start` dans `run-1`, puis ouvrez http://localhost:3000. Elle ne demande aucune installation : Node 24 et sa base SQLite intégrée suffisent.

Je l'ai testée dans Chrome sur des données de démo (513 inscrits), sur ordinateur et sur mobile, en thème clair et en thème sombre. La création de liste, l'inscription, le dashboard et l'export sont aussi couverts par des tests automatiques (`npm test`), qui passent.

**Le parcours :**
1. **Accueil** : vous tapez le titre et la description de votre projet, et un aperçu de la page publique se met à jour pendant la saisie. Vous obtenez ensuite deux liens :
   - la page publique `/w/<nom-du-projet>`, à partager ;
   - le dashboard `/admin/<clé>`, à garder pour vous.
2. **Page publique** : un fond en dégradé animé, une carte en verre dépoli, un grand titre et un champ email. Le nombre d'inscrits est affiché, et après l'inscription on voit sa place (« Vous êtes n°514 sur la liste »). Une même adresse ne peut s'inscrire qu'une fois, et la page marche aussi sans JavaScript.
3. **Dashboard** :
   - le total des inscrits, ceux du jour, et les 7 derniers jours comparés aux 7 précédents ;
   - un graphique des inscriptions par jour (14, 30 ou 90 jours) ;
   - la liste des inscrits avec recherche, export CSV et suppression d'un inscrit ;
   - la modification du titre et de la description, et la suppression de la liste ;
   - une mise à jour automatique toutes les 15 secondes, avec une notification à chaque nouvel inscrit.

Le thème clair ou sombre suit le réglage de votre appareil.

**À savoir :**
- **Il n'y a pas de comptes.** Le lien du dashboard sert de mot de passe : c'est simple, mais si vous le perdez, vous perdez l'accès à vos inscrits. Votre navigateur s'en souvient (section « Mes listes » sur l'accueil), mais gardez-en une copie ailleurs. Je peux ajouter une connexion par email si vous préférez.
- **Aucun email n'est envoyé.** Les gens qui s'inscrivent ne reçoivent pas de confirmation ; pour les contacter, exportez la liste en CSV.
- **Pour la mise en ligne**, prévoyez un hébergeur qui garde le fichier de données entre deux redémarrages (il est dans `data/waitlist.db`). Si l'app tourne derrière un proxy, mettez `TRUST_PROXY=1` pour que la limite anti-abus voie la vraie adresse des visiteurs. Le README détaille ces réglages.

En testant, j'ai trouvé et corrigé un bug sur mobile : le champ email était écrasé dans la page publique. Les données de démo et les captures étaient temporaires, je les ai supprimées.

Fichiers : `server.js` (serveur), `public/` (pages, styles et scripts), `test/api.test.js` et `README.md`.
