# Waitlist

Des listes d'attente en quelques secondes : vous créez une liste pour votre projet, vous obtenez une page publique (titre, description, formulaire email) et un dashboard privé avec les inscrits, le total et un graphique des inscriptions.

Aucune dépendance : Node.js ≥ 22.13 suffit (serveur HTTP natif + SQLite intégré `node:sqlite`).

## Lancer

```bash
npm start          # http://localhost:3000
npm run dev        # avec rechargement automatique
```

Variables d'environnement facultatives :

| Variable   | Défaut              | Rôle                                                   |
|------------|---------------------|--------------------------------------------------------|
| `PORT`     | `3000`              | Port HTTP                                              |
| `DB_PATH`  | `data/waitlist.db`  | Fichier SQLite                                         |
| `BASE_URL` | déduit de la requête | URL publique affichée dans les liens (en production)  |

## Fonctionnement

- **`/`**: créer une liste. Les listes créées sur cet appareil sont rappelées en bas de page.
- **`/w/<slug>`**: page publique à partager. Inscription sans rechargement, doublons détectés, compteur d'inscrits ; fonctionne aussi sans JavaScript.
- **`/admin/<jeton>`**: dashboard privé. Total, aujourd'hui, 7 derniers jours, histogramme sur 30 jours (avec vue tableau), recherche, suppression d'un inscrit, export CSV, modification de la page, suppression de la liste.

Il n'y a pas de comptes : **l'URL du dashboard contient un jeton secret et c'est la seule clé d'accès**. Gardez-la en favori et ne la partagez pas.

## Sécurité

- Échappement HTML systématique, CSP stricte (aucun script inline), `Referrer-Policy: no-referrer`.
- Anti-spam : champ « pot de miel » + limite de 8 inscriptions/minute par IP.
- Export CSV protégé contre l'injection de formules (Excel/Sheets).
