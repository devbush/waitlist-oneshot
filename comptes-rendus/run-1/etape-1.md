# Run 1, étape 1 : comptes utilisateurs

- Durée : 9.9 min
- Tours de l'agent : 52
- Coût cumulé de la session, estimé au tarif public de l'API : 4.95 $

## Prompt

```text
Ajoute des comptes. Chacun se connecte et voit seulement ses listes.
```

## Réponse de l'agent

Texte brut, non corrigé. Ce que l'agent affirme ici n'est pas vérifié : voir `audits/`.

---

Les comptes sont en place : chacun crée un compte (email + mot de passe), se connecte et ne voit que ses propres listes. Les 6 tests automatiques passent. J'ai aussi déroulé tout le parcours dans Chrome, en clair et en sombre, sur mobile et sur ordinateur : création de compte, première liste, « Mes listes », dashboard, déconnexion puis reconnexion.

**Ce qui change pour vous :**
- **Accueil (`/`)** : une page de présentation avec « Créer un compte » et « Se connecter ». Une fois connecté, vous arrivez directement sur vos listes.
- **Connexion / inscription** : une carte dans le même style que les pages publiques, avec un bouton pour afficher le mot de passe. Si vous ouvrez une page privée sans être connecté, vous êtes renvoyé à la connexion, puis ramené à la page demandée.
- **Mes listes (`/app`)** : une tuile par liste avec son nombre d'inscrits et les nouveaux de la semaine. Le bouton « Nouvelle liste » ouvre le formulaire avec l'aperçu en direct. Un nouveau compte arrive directement sur un écran « Créez votre première liste d'attente ».
- **Dashboard (`/app/lists/<nom>`)** : il est inchangé, avec en plus le chemin « Mes listes / Nébula » et votre email en haut.
- **Le lien secret `/admin/<clé>` disparaît** : c'est maintenant le compte qui donne accès au dashboard. Les pages publiques `/w/<nom>` ne changent pas.

**Ce qui empêche de voir les listes des autres :**
- Toute liste qui ne vous appartient pas répond « introuvable ». Un autre compte ne peut ni la lire, ni la modifier, ni l'exporter, ni la supprimer, et ne peut même pas savoir qu'elle existe. Un test le vérifie pour chaque action.
- Les mots de passe sont hachés avec scrypt : ils ne sont jamais stockés en clair.
- La session est dans un cookie inaccessible au JavaScript, et elle est supprimée côté serveur à la déconnexion.
- Les requêtes qui modifient des données sont refusées si elles viennent d'un autre site.
- Les tentatives de connexion sont limitées pour freiner le piratage par essais successifs.

**Points à connaître :**
- **Il n'y a pas de « mot de passe oublié »** : il faudrait pouvoir envoyer des emails, et l'app n'en envoie pas pour l'instant. Pour la même raison, les adresses à l'inscription ne sont pas vérifiées. Je peux brancher un service d'envoi d'emails si vous voulez.
- **Pas encore de changement de mot de passe ni de suppression de compte** depuis l'interface.
- **Vous n'aviez encore aucune donnée**, donc rien n'est perdu. J'ai quand même prévu une migration automatique pour une base de l'ancienne version, et je l'ai testée : les anciennes listes gardent leur page publique et leurs inscrits, mais n'apparaissent dans aucun compte.

Fichiers : `server.js` a été réécrit. Dans `public/`, il y a de nouvelles pages (`auth.*` pour la connexion, `app.*` pour « Mes listes ») ; `home.html` est maintenant la page de présentation et l'ancien `home.js` est supprimé. Les tests sont dans `test/api.test.js` et le README est à jour.
