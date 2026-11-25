# Run 2, étape 4 : parrainage

- Durée : 5.8 min
- Tours de l'agent : 34
- Coût cumulé de la session, estimé au tarif public de l'API : 10.41 $

## Prompt

```text
Ajoute le parrainage : chaque inscrit a un lien, et il monte dans la liste quand quelqu'un s'inscrit avec.
```

## Réponse de l'agent

Texte brut, non corrigé. Ce que l'agent affirme ici n'est pas vérifié : voir `audits/`.

---

Le parrainage est en place : chaque inscrit voit sa position dans la liste et reçoit un lien personnel. Chaque ami qui s'inscrit avec ce lien lui fait gagner 5 places.

**Pour l'inscrit**
- Après l'inscription, la page affiche **« Votre position : n°61 sur 61 »**, son lien (`/w/<liste>?ref=…`) et des boutons **Copier** et **Partager** (le partage natif du téléphone).
- Un visiteur arrivé par un lien voit **« Un ami vous a invité·e »**. L'email du parrain n'est jamais affiché.
- Pour retrouver sa position plus tard, il suffit de **ré-entrer son email** sur la page. Le lien de parrainage peut circuler sans révéler la position de son propriétaire.

**Pour toi, dans le dashboard**
- Les inscrits sont **classés par position**, avec une colonne « Parrainages ».
- Une nouvelle tuile « Via parrainage » indique combien d'inscrits sont arrivés par un lien.
- L'export CSV suit le même ordre, avec les colonnes `position, email, parrainages, inscrit_le`.

**La règle de classement :** on part de l'ordre d'inscription, puis chaque ami parrainé fait gagner 5 places. À égalité, le premier inscrit passe devant. Si tu veux un effet plus fort ou plus faible, c'est une seule valeur à changer dans `src/plans.js`.

**Anti-triche :**
- Un parrainage ne compte que s'il vient d'une autre connexion internet (IP) que celle du parrain.
- Plusieurs amis inscrits depuis une même connexion ne comptent qu'une fois.
- Les IP ne sont pas stockées en clair, seulement sous une forme brouillée et non réversible.
- Si tu retires un inscrit suspect, son parrain perd les places correspondantes.

La limite : comme les emails ne sont pas confirmés, quelqu'un qui dispose de plusieurs connexions peut encore tricher. Pour fermer ce trou, il faudrait envoyer un email de confirmation avant de compter le parrainage.

**À faire en production :** si l'app tourne derrière un proxy (Nginx, Render, Fly…), mets `TRUST_PROXY=1`. Sans ça, tous les visiteurs semblent avoir la même IP : plus aucun parrainage ne compte, et la limite de 8 inscriptions par minute s'applique à tout le monde à la fois.

**Tests :**
- **Parrainage, 28 vérifications, toutes OK :** calcul des positions, triche depuis la même IP, codes inconnus ou venant d'une autre liste, version sans JavaScript, tri du dashboard et de l'export, retrait d'un filleul, limite par IP. Elles couvrent aussi la migration d'une base existante : les anciens inscrits reçoivent un lien et peuvent parrainer.
- **Stripe et quota, 43 vérifications :** je les ai relancées, rien n'a cassé.
- **Rendu :** vérifié en clair, en sombre et sur mobile. J'ai corrigé le champ du lien, illisible sur petit écran.

Le README et `.env.example` sont à jour.
