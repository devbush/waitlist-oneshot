# Waitlist

Créez des listes d'attente pour vos projets : chaque liste a une page publique (titre, description, formulaire email), et votre compte donne accès à un dashboard pour suivre les inscrits.

## Lancer

Requiert **Node.js ≥ 22.13** (utilise le SQLite intégré à Node — aucune dépendance à installer).

```bash
npm start          # http://localhost:3000
npm run dev        # avec rechargement automatique
```

## Pages

| URL | Accès | Rôle |
|---|---|---|
| `/` | public | Présentation (redirige vers `/app` si connecté) |
| `/signup`, `/login` | public | Création de compte, connexion |
| `/app` | connecté | Mes listes (total et inscrits de la semaine par liste), création |
| `/app/lists/<slug>` | propriétaire | Dashboard : stats, graphique 30 jours, recherche, suppression d'inscrits, export CSV, modification, suppression de la liste |
| `/w/<slug>` | public | Page d'inscription à partager |

Chaque compte ne voit et ne modifie **que ses propres listes** : une liste d'un autre compte répond « introuvable » (404), aussi bien dans les pages que dans l'API.

## Comptes

- Email + mot de passe (8 caractères minimum), hachés avec **scrypt** (sel aléatoire par compte).
- Session par cookie `HttpOnly`, `SameSite=Lax`, valable 30 jours ; seul un hash SHA-256 du jeton est stocké en base. `Secure` est ajouté automatiquement en HTTPS.
- La déconnexion invalide la session côté serveur.

### Listes créées avant les comptes

Elles n'ont pas de propriétaire. Elles sont rattachées au premier compte qui :
- ouvre leur ancien lien secret `/d/<jeton>` une fois connecté ;
- ou se connecte depuis le navigateur qui les avait créées (les jetons mémorisés localement sont rattachés automatiquement).

## Configuration

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `3000` | Port HTTP |
| `DB_PATH` | `./data/waitlist.db` | Fichier SQLite (le schéma est migré automatiquement) |
| `TRUST_PROXY` | — | Mettre `1` derrière un reverse proxy : IP réelle (limites de débit) et détection HTTPS (cookie `Secure`) |
| `NODE_ENV` | — | `production` met les templates HTML en cache mémoire |

## Protections incluses

- Mots de passe hachés (scrypt), comparaison à temps constant, même temps de réponse pour un email inconnu.
- Limites de débit : connexion (10 essais / 15 min par email, 30 par IP), création de compte (10 / h par IP), inscriptions publiques (20 / 10 min par IP).
- Anti-CSRF : cookie `SameSite=Lax` + vérification de l'en-tête `Origin` sur toute requête qui modifie des données.
- Redirection après connexion limitée aux chemins internes (pas de redirection ouverte).
- Échappement HTML de tout contenu utilisateur, Content-Security-Policy stricte, pot de miel anti-bots, protection contre l'injection de formules dans l'export CSV.

## Non inclus

Pas de réinitialisation de mot de passe par email ni de vérification d'email : l'app n'envoie aucun email. Un compte qui oublie son mot de passe doit être réinitialisé à la main en base.
