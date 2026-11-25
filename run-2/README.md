# Waitlist

Des listes d'attente en quelques secondes. Créez un compte, créez une liste pour votre projet : vous obtenez une page publique (titre, description, formulaire email) et un dashboard avec les inscrits, le total et un graphique des inscriptions. Chaque compte ne voit que ses propres listes.

Aucune dépendance : Node.js ≥ 22.13 suffit (serveur HTTP natif + SQLite intégré `node:sqlite`).

## Lancer

```bash
npm start          # http://localhost:3000
npm run dev        # avec rechargement automatique
```

Variables d'environnement facultatives :

| Variable   | Défaut               | Rôle                                                                    |
|------------|----------------------|-------------------------------------------------------------------------|
| `PORT`     | `3000`               | Port HTTP                                                               |
| `DB_PATH`  | `data/waitlist.db`   | Fichier SQLite                                                          |
| `BASE_URL` | déduit de la requête | URL publique (liens affichés + cookie `Secure` si elle commence par `https:`) |

## Pages

| URL | Accès | Rôle |
|---|---|---|
| `/` | public | Présentation (redirige vers `/lists` si connecté) |
| `/signup`, `/login` | public | Création de compte, connexion |
| `/lists` | connecté | Mes listes (stats rapides) + création d'une liste |
| `/lists/<slug>` | propriétaire | Dashboard : total, aujourd'hui, 7 jours, histogramme 30 jours, recherche, export CSV, édition, suppression |
| `/w/<slug>` | public | Page d'inscription à partager (fonctionne aussi sans JavaScript) |

Une liste appartenant à un autre compte renvoie un 404, ce qui ne révèle même pas qu'elle existe.

## Comptes & sécurité

- Mots de passe hachés avec **scrypt** (sel aléatoire, comparaison à temps constant, 8 caractères minimum).
- Sessions de 30 jours : cookie `HttpOnly`, `SameSite=Lax` (et `Secure` en HTTPS). Seul le hash SHA-256 du jeton est stocké en base. La déconnexion invalide la session côté serveur.
- Anti-CSRF : les formulaires authentifiés doivent provenir de la même origine (en-tête `Origin`/`Referer`).
- Anti force brute : 10 échecs de connexion/inscription par IP sur 15 minutes. Les connexions réussies ne comptent pas.
- Échappement HTML systématique, CSP stricte (aucun script ni style inline), `Referrer-Policy: no-referrer`.
- Pages publiques : champ « pot de miel » + 8 inscriptions/minute par IP.
- Export CSV protégé contre l'injection de formules (Excel/Sheets).

Pas encore inclus : réinitialisation du mot de passe par email (il faudrait un service d'envoi d'emails).

## Migration depuis la version sans comptes

Les listes créées avant l'ajout des comptes n'ont pas de propriétaire. Pour en récupérer une, ouvrez son ancien lien secret `/admin/<jeton>` : on vous demande de vous connecter (ou de créer un compte), puis la liste est rattachée à votre compte. Le lien ne fonctionne qu'une fois : une liste déjà rattachée ne peut plus être revendiquée par un autre compte.
