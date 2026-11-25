# Waitlist

Une petite app pour créer des listes d’attente. Chaque utilisateur a un compte. Il y crée des listes, et chaque liste a une **page publique** (titre, description, formulaire email). Un **dashboard privé** affiche les inscrits et leur total. Chacun ne voit que ses propres listes.

L’app n’a aucune dépendance : Node.js ≥ 22.13 et le module SQLite intégré (`node:sqlite`) suffisent.

## Démarrer

```bash
npm start          # http://localhost:3000
npm run dev        # redémarre automatiquement quand le code change
npm test           # tests d’intégration (comptes, isolation, API)
```

Variables d’environnement :

| Variable      | Défaut             | Rôle                                                                          |
|---------------|--------------------|-------------------------------------------------------------------------------|
| `PORT`        | `3000`             | Port HTTP                                                                     |
| `DB_PATH`     | `data/waitlist.db` | Fichier SQLite                                                                |
| `TRUST_PROXY` | —                  | `1` derrière un reverse proxy : l’IP est lue dans `X-Forwarded-For`, et le cookie passe en `Secure` si `X-Forwarded-Proto` vaut `https` |

## Pages

| URL                 | Accès     | Contenu                                                                 |
|---------------------|-----------|-------------------------------------------------------------------------|
| `/`                 | public    | Présentation (redirige vers `/app` si vous êtes connecté)               |
| `/signup`, `/login` | public    | Création de compte, connexion                                           |
| `/app`              | connecté  | Mes listes, et création d’une liste avec aperçu en direct               |
| `/app/lists/<slug>` | connecté  | Dashboard : total, aujourd’hui, 7 jours, graphique, inscrits, CSV, réglages |
| `/w/<slug>`         | public    | Page d’inscription à la liste (fonctionne même sans JavaScript)         |

## Comptes et sécurité

- **Mots de passe** : 8 caractères minimum, hachés avec scrypt et un sel aléatoire. Le serveur ne garde jamais le mot de passe en clair.
- **Sessions** : un jeton aléatoire de 256 bits, stocké dans un cookie `HttpOnly; SameSite=Lax`. La base ne garde que son empreinte SHA-256. Une session dure 30 jours et se prolonge tant qu’elle sert. La déconnexion la supprime côté serveur.
- **Isolation** : chaque requête sur une liste vérifie qu’elle appartient à l’utilisateur connecté. Sinon, la réponse est un 404, ce qui ne révèle même pas que la liste existe.
- **CSRF** : en plus de `SameSite=Lax`, le serveur refuse toute requête qui modifie des données si son en-tête `Origin` vient d’un autre site.
- **Anti-abus** : la connexion est limitée par IP et par email, de même que la création de comptes et les inscriptions publiques. Un champ pot de miel filtre les robots.
- **Contenu** : tout le contenu est échappé, la CSP est stricte, les iframes sont interdites, et l’export CSV neutralise les injections de formules.

## Mise à jour depuis la version sans comptes

Au premier démarrage, une ancienne base est migrée automatiquement. Les listes déjà créées gardent leur page publique et leurs inscrits, mais n’appartiennent à aucun compte : elles n’apparaissent donc dans aucun dashboard. Les anciens liens `/admin/<clé>` ne fonctionnent plus.

## Limites actuelles

- Pas de « mot de passe oublié » ni de vérification de l’email : il faudrait un service d’envoi d’emails.
- Pas encore de changement de mot de passe ni de suppression de compte depuis l’interface.
