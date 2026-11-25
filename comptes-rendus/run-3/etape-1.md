# Run 3, étape 1 : comptes utilisateurs

- Durée : 6.9 min
- Tours de l'agent : 28
- Coût cumulé de la session, estimé au tarif public de l'API : 4.30 $

## Prompt

```text
Ajoute des comptes. Chacun se connecte et voit seulement ses listes.
```

## Réponse de l'agent

Texte brut, non corrigé. Ce que l'agent affirme ici n'est pas vérifié : voir `audits/`.

---

Les comptes sont en place : chacun crée un compte avec email et mot de passe, se connecte et ne voit que ses propres listes.

## Ce qui change pour toi
- **Accueil (`/`)** : une page de présentation avec « Créer mon compte » et « Se connecter ». Si tu es déjà connecté, elle t'envoie directement sur tes listes.
- **Inscription et connexion (`/signup`, `/login`)** : mot de passe de 8 caractères minimum, avec un bouton pour l'afficher. Après connexion, tu reviens sur la page que tu voulais ouvrir.
- **Mes listes (`/app`)** : une carte par liste avec son total d'inscrits et ceux de la semaine. Le bouton « Nouvelle liste » ouvre un formulaire.
- **Dashboard (`/app/lists/<slug>`)** : le même qu'avant, avec en plus un lien retour, ton compte en haut à droite et la suppression de la liste (dans « Modifier », avec confirmation).
- **Page publique** : rien ne change, les visiteurs s'inscrivent toujours sans compte.

## Sécurité
- **Isolation** : si quelqu'un ouvre ou appelle une liste qui ne lui appartient pas, il obtient « introuvable », que ce soit sur la page ou via l'API.
- **Mots de passe** : ils sont hachés avec scrypt. Le cookie de session n'est pas lisible par JavaScript, dure 30 jours et est invalidé côté serveur à la déconnexion.
- **Anti-force brute** : 10 essais de connexion par email toutes les 15 minutes, et la réponse prend le même temps que l'email existe ou non.
- **Anti-CSRF** : les requêtes qui modifient des données venant d'un autre site sont refusées, et la redirection après connexion ne peut pas envoyer vers un site externe.

## Listes déjà créées
La base existante est mise à jour automatiquement au démarrage. Une liste créée avant les comptes revient au premier compte qui ouvre son ancien lien `/d/…` en étant connecté, ou qui se connecte depuis le navigateur qui l'avait créée. Une fois rattachée, personne d'autre ne peut la récupérer.

## Ce que j'ai testé
- **Côté serveur** : création de compte, refus d'un doublon ou d'un mot de passe trop court, mauvais mot de passe, email inconnu. J'ai vérifié l'isolation entre deux comptes (lecture, suppression et export refusés), le refus sans connexion, le blocage CSRF, la déconnexion, la suppression d'une liste et la reprise d'anciennes listes sur une base au format précédent.
- **Dans Chrome** : inscription par le formulaire, création d'une liste puis arrivée sur son dashboard, déconnexion, message d'erreur en cas de mauvais mot de passe, accès bloqué une fois déconnecté. J'ai aussi contrôlé le rendu en clair, en sombre et sur mobile.
- **Correction au passage** : un défaut de l'axe du graphique, qui affichait des graduations décimales (« 3,8 ») pour de petits nombres.

## Limite à connaître
L'app n'envoie aucun email, donc il n'y a ni « mot de passe oublié » ni vérification de l'adresse. Si quelqu'un perd son mot de passe, il faut le réinitialiser à la main dans la base. Je peux ajouter l'envoi d'emails (avec un service SMTP ou Resend) si tu veux ces deux fonctions.
