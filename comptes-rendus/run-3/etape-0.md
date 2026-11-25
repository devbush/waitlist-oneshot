# Run 3, étape 0 : one-shot

- Durée : 9.6 min
- Tours de l'agent : 50
- Coût cumulé de la session, estimé au tarif public de l'API : 2.29 $

## Prompt

```text
Construis-moi une app de listes d'attente. Je crée une liste pour mon projet, ça me donne une page publique avec un titre, une description et un formulaire email. Les gens s'inscrivent, et moi je vois les inscrits et le total dans un dashboard. Fais un truc joli.
```

## Réponse de l'agent

Texte brut, non corrigé. Ce que l'agent affirme ici n'est pas vérifié : voir `audits/`.

---

L'app est prête dans `run-3`. Elle n'a aucune dépendance à installer : il suffit de Node ≥ 22.13 (tu as la v24). Le stockage utilise le SQLite intégré à Node.

```bash
npm start   # → http://localhost:3000
```

## Comment ça marche

1. **Accueil (`/`)** : tu donnes un nom et une description, et la liste est créée. La page garde aussi en mémoire, dans ton navigateur, les listes que tu as déjà créées.
2. **Page publique (`/w/<slug>`)** : elle affiche le titre, la description, le formulaire email et le nombre d'inscrits. Une fois inscrite, la personne voit sa place dans la file (par exemple « #214 »). Si l'email est déjà inscrit, la page le lui dit au lieu d'afficher une erreur.
3. **Dashboard (`/d/<jeton>`)** : il montre le total, les inscriptions du jour comparées à la veille, celles des 7 derniers jours comparées à la semaine précédente, et un graphique en barres sur 30 jours avec une info-bulle au survol. Tu as aussi la liste des inscrits avec recherche et suppression, l'export CSV, la modification du titre et de la description, et un bouton pour copier le lien public. Le dashboard se rafraîchit tout seul toutes les 20 secondes.

Il n'y a pas de compte : **c'est l'adresse du dashboard qui sert de mot de passe** (jeton aléatoire). Un bandeau le rappelle au moment de la création. Si tu perds ce lien et que ton navigateur ne l'a pas gardé, tu ne peux plus ouvrir le dashboard. Il faudra un vrai système de comptes si tu veux plus que ça.

**Design** : thème violet avec dégradés, thème clair et sombre selon le réglage du système, version mobile.

**Sécurité de base** : tout ce que saisissent les utilisateurs est échappé avant affichage, et le site applique une politique de sécurité stricte. J'ai aussi ajouté une limite d'inscriptions par adresse IP, un champ caché pour piéger les bots, une protection contre l'injection de formules dans le CSV, et le jeton n'est jamais transmis aux autres sites.

## Ce que j'ai vérifié
- **Les appels au serveur** : création, inscription, doublon, email invalide, export CSV, pages 404 et caractères spéciaux comme `<b>` ou les accents.
- **Dans Chrome** : création d'une liste jusqu'au dashboard, puis inscription jusqu'à l'écran de confirmation. J'ai contrôlé le rendu par captures d'écran en clair, en sombre et en largeur mobile (390 px).
- **Corrections faites pendant les tests** : un débordement horizontal du dashboard sur mobile et des dates du graphique qui se chevauchaient.

## À savoir
- **Limite d'inscriptions** : elle est de 20 par IP toutes les 10 minutes. En testant beaucoup, tu verras « Trop de tentatives » ; redémarrer le serveur remet le compteur à zéro.
- **Derrière un proxy** (hébergeur, Nginx) : définis `TRUST_PROXY=1`. Sinon, tous les visiteurs semblent venir de la même IP et se partagent cette limite.
- **Aucun email n'est envoyé** aux inscrits : l'app récolte les adresses, et l'export CSV sert à les passer dans ton outil d'emailing.

Le README détaille les variables de configuration.
