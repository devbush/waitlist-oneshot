# Waitlist

Créez une liste d'attente pour votre projet en 30 secondes : une page publique (titre, description, formulaire email) et un dashboard privé pour suivre les inscrits.

## Lancer

Requiert **Node.js ≥ 22.13** (utilise le SQLite intégré à Node — aucune dépendance à installer).

```bash
npm start          # http://localhost:3000
npm run dev        # avec rechargement automatique
```

## Fonctionnement

| URL | Rôle |
|---|---|
| `/` | Créer une liste ; retrouver les listes créées sur cet appareil |
| `/w/<slug>` | Page publique à partager |
| `/d/<jeton>` | Dashboard privé : total, aujourd'hui, 7 jours, graphique 30 jours, recherche, suppression, export CSV, modification du titre/description |

Pas de compte : **l'adresse du dashboard est la clé d'accès** (jeton aléatoire de 192 bits). Gardez-la en favori et ne la partagez pas. Elle est aussi mémorisée dans le navigateur qui a créé la liste.

## Configuration

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `3000` | Port HTTP |
| `DB_PATH` | `./data/waitlist.db` | Fichier SQLite |
| `TRUST_PROXY` | — | Mettre `1` derrière un reverse proxy pour lire l'IP réelle (limite de débit) |
| `NODE_ENV` | — | `production` met les templates HTML en cache mémoire |

## Protections incluses

Échappement HTML de tout contenu utilisateur, Content-Security-Policy stricte, emails dédupliqués par liste, limite de débit par IP (20 inscriptions / 10 min, 10 créations de liste / h), champ pot de miel anti-bots, protection contre l'injection de formules dans l'export CSV, `Referrer-Policy: no-referrer` pour ne pas faire fuiter le jeton.
