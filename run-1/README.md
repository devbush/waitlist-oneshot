# Waitlist

Une petite app pour créer des listes d’attente : chaque liste a une **page publique** (titre, description, formulaire email) et un **dashboard privé** qui affiche les inscrits et leur nombre total.

Elle n’a aucune dépendance : Node.js ≥ 22.13 et le module SQLite intégré (`node:sqlite`) suffisent.

## Démarrer

```bash
npm start          # http://localhost:3000
npm run dev        # redémarre automatiquement quand le code change
npm test           # tests d’intégration de l’API
```

Variables d’environnement :

| Variable      | Défaut               | Rôle                                                         |
|---------------|----------------------|--------------------------------------------------------------|
| `PORT`        | `3000`               | Port HTTP                                                    |
| `DB_PATH`     | `data/waitlist.db`   | Fichier SQLite                                               |
| `TRUST_PROXY` | —                    | `1` pour lire l’IP client dans `X-Forwarded-For` (derrière un reverse proxy) |

## Fonctionnement

- **Accueil (`/`)** : vous créez une liste et un aperçu de la page publique se met à jour pendant la saisie. Vous recevez ensuite deux liens :
  - `/w/<slug>` : la page publique, à partager ;
  - `/admin/<jeton>` : le dashboard. **Ce lien est secret et sert de mot de passe.** Le navigateur le mémorise (section « Mes listes »), mais gardez-en une copie ailleurs.
- **Page publique** : elle est rendue côté serveur et fonctionne même sans JavaScript. Elle affiche le nombre d’inscrits et, une fois l’inscription faite, la position de la personne dans la file. Une même adresse ne peut s’inscrire qu’une fois par liste.
- **Dashboard** : total des inscrits, inscriptions du jour, 7 derniers jours comparés aux 7 précédents, graphique par jour (14, 30 ou 90 jours), recherche, export CSV, suppression d’un inscrit, modification de la page et suppression de la liste. Il se rafraîchit tout seul toutes les 15 secondes.

## Sécurité

- Le jeton admin fait 192 bits aléatoires. Le dashboard envoie `Referrer-Policy: no-referrer` et `noindex`.
- Tout le contenu est échappé, la CSP est stricte et les iframes sont interdites.
- Les inscriptions sont limitées à 20 par minute et par IP, et un champ pot de miel filtre les robots.
- L’export CSV neutralise les injections de formules.
