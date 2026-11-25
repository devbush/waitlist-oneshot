# Run 2, étape 1 : comptes utilisateurs

- Durée : 7.4 min
- Tours de l'agent : 41
- Coût cumulé de la session, estimé au tarif public de l'API : 4.37 $

## Prompt

```text
Ajoute des comptes. Chacun se connecte et voit seulement ses listes.
```

## Réponse de l'agent

Texte brut, non corrigé. Ce que l'agent affirme ici n'est pas vérifié : voir `audits/`.

---

Les comptes sont en place : chacun crée un compte, se connecte et ne voit que ses propres listes.

**Le parcours**
- **Accueil (`/`) :** une page de présentation avec un aperçu de la page publique et les boutons « Créer mon compte » et « J'ai déjà un compte ».
- **Inscription et connexion (`/signup`, `/login`) :** un email et un mot de passe de 8 caractères minimum. Après connexion, on revient sur la page qu'on voulait ouvrir.
- **Mes listes (`/lists`) :** une carte par liste, avec le nombre d'inscrits et le nombre d'inscrits de la semaine, plus le formulaire de création.
- **Dashboard (`/lists/<nom-de-la-liste>`) :** le même qu'avant. La barre du haut affiche le compte connecté et un bouton « Déconnexion ».
- **Page publique (`/w/...`) :** inchangée, les visiteurs s'inscrivent toujours sans compte.

**Ce que j'ai vérifié avec deux comptes, A et B :**
- B ne voit pas les listes de A. Il ne peut ni ouvrir le dashboard de A, ni télécharger son CSV, ni supprimer sa liste : il reçoit une page « introuvable », ce qui ne révèle même pas que la liste existe.
- Un formulaire envoyé depuis un autre site est refusé.
- Un mauvais mot de passe et un email inconnu donnent le même message d'erreur.
- Au 11ᵉ échec de connexion depuis une même IP, l'accès est bloqué 15 minutes.
- Après déconnexion, la session ne fonctionne plus.
- La redirection après connexion refuse d'envoyer vers un site externe.

J'ai aussi regardé toutes les pages en clair, en sombre et sur mobile (390 px).

**Sécurité :** les mots de passe sont stockés sous forme chiffrée irréversible (scrypt), jamais en clair. La session dure 30 jours, dans un cookie inaccessible aux scripts de la page.

**Ce que j'ai corrigé pendant les tests :**
- La limite anti-force-brute comptait aussi les connexions réussies. Plusieurs personnes derrière la même connexion (un bureau, par exemple) pouvaient donc se bloquer. Seuls les échecs comptent maintenant.
- Le champ mot de passe n'avait pas le même style que les autres champs.
- « 0 inscrits » est devenu « 0 inscrit ».

**Anciennes listes :** si tu as des listes créées avec la version précédente, ouvre leur ancien lien secret `/admin/...`. Après connexion, la liste est rattachée à ton compte, et personne d'autre ne peut plus la récupérer ensuite. J'ai testé ce cas sur une base de l'ancienne version.

**Pas encore fait :** la réinitialisation du mot de passe en cas d'oubli. Elle demande d'envoyer des emails, donc de brancher un service d'envoi. Dis-moi si tu veux que je m'en occupe.

Le `README.md` est à jour. J'ai supprimé les bases de test, et l'app démarre vide avec `npm start`.
