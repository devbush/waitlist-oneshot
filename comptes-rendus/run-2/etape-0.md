# Run 2, étape 0 : one-shot

- Durée : 8.8 min
- Tours de l'agent : 37
- Coût cumulé de la session, estimé au tarif public de l'API : 2.00 $

## Prompt

```text
Construis-moi une app de listes d'attente. Je crée une liste pour mon projet, ça me donne une page publique avec un titre, une description et un formulaire email. Les gens s'inscrivent, et moi je vois les inscrits et le total dans un dashboard. Fais un truc joli.
```

## Réponse de l'agent

Texte brut, non corrigé. Ce que l'agent affirme ici n'est pas vérifié : voir `audits/`.

---

Ton app de listes d'attente est prête dans `run-2`. Il n'y a aucune dépendance : Node fournit déjà le serveur web et la base de données (SQLite, Node 22.13 minimum).

```bash
npm start   # http://localhost:3000
```

**Le parcours**
1. **Accueil (`/`)** : tu donnes un titre et une description, puis tu cliques sur « Créer ma liste ».
2. **Page publique (`/w/nom-du-projet-xxxx`)** : une carte sur fond dégradé animé avec le titre, la description et le champ email. Elle affiche le nombre d'inscrits (« 190 personnes déjà inscrites »). L'inscription se fait sans recharger la page, avec une coche animée à la fin. Si l'email est déjà inscrit, la page le dit. Le formulaire marche aussi sans JavaScript.
3. **Dashboard (`/admin/<lien secret>`)** :
   - le total des inscrits, ceux d'aujourd'hui et des 7 derniers jours (avec la comparaison à la semaine précédente) ;
   - un graphique des inscriptions par jour sur 30 jours, avec le détail au survol et une vue en tableau ;
   - la liste des inscrits, avec recherche, retrait d'un inscrit et export CSV ;
   - la modification de la page et la suppression de la liste.

L'app suit le thème clair ou sombre de ton système et s'adapte au mobile.

**Un point à savoir :** il n'y a pas de comptes. **L'adresse du dashboard est la seule clé d'accès.** Elle s'affiche juste après la création avec un bouton « Copier », et l'accueil rappelle les listes créées depuis ce navigateur. Si tu perds ce lien, tu perds l'accès au dashboard.

**Sécurité :**
- **Anti-spam :** un champ caché piège les robots, et une même adresse IP est limitée à 8 inscriptions par minute.
- **Pages :** tout le texte saisi est neutralisé avant affichage, et le navigateur refuse tout script non prévu.
- **Export CSV :** un email ne peut pas se transformer en formule à l'ouverture dans Excel ou Sheets.

**Ce que j'ai testé :**
- **Toutes les actions, avec de vraies requêtes :** création, inscription, doublon, email invalide, piège anti-robots, formulaire sans JavaScript, modification, retrait d'un inscrit, suppression de la liste et export CSV. Tout fonctionne.
- **Accents :** ils passent correctement.
- **Rendu, sur captures d'écran :** j'ai vérifié les pages en clair, en sombre et en mobile, et corrigé deux défauts du tableau des inscrits. Sur mobile, je n'ai pu vérifier qu'à 500 px de large, le minimum de mon outil de capture, pas sur un écran de téléphone plus étroit.

**Pas inclus :** l'app ne fait que collecter les emails, elle n'envoie rien. Pour prévenir tes inscrits, exporte le CSV vers ton outil d'emailing. En production, définis `BASE_URL` pour que les liens affichés soient les bons. Tout est dans le `README.md`.
