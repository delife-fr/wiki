# WIKI — consignes pour Claude

Appli wiki personnelle façon Wikipédia. Ce dépôt (`delife-fr/wiki`) est **public** et ne contient que le code. Le contenu de l'utilisateur est dans le dépôt **privé** `delife-fr/wiki-donnees` (`articles/*.md`, `medias/*`), lu et écrit par l'appli via l'API GitHub avec une clé gardée dans le navigateur.

## Règles
- Jamais de contenu personnel dans ce dépôt (ni dans les tests, la démo ou les exemples) : il est public.
- Pas d'étape de compilation : modules ES natifs, servis tels quels par GitHub Pages. Pas de bibliothèque chargée depuis un CDN.
- Les bibliothèques sont dans `vendor/bibliotheques.js`, reconstruit par `outils/vendor/construire.sh` (versions figées dans `outils/vendor/package.json`).
- Tout HTML issu d'un article passe par `nettoyer()` (DOMPurify) dans `js/rendu.js`. Garder la CSP de `index.html` stricte (`script-src 'self'`, `style-src 'self'` : pas d'attribut `style` dans le HTML généré, utiliser `el.style` ou des classes).
- À chaque changement livré : incrémenter `VERSION` dans `sw.js` et `js/reglages.js` ; tout nouveau fichier servi doit être ajouté à `FICHIERS` dans `sw.js`.
- Code, noms et commentaires en français (comme LIFE PANEL). Textes de l'interface en français, apostrophes typographiques (’) et guillemets « ».
- Format des articles compatible Obsidian : titre = nom du fichier, `[[Titre|texte]]`, `![[photo.jpg|légende|300]]`, bloc YAML en tête (`categories`, `aliases`, `image`, `legende`, autres clés → encadré).

## Architecture
- `js/github.js` : `SourceGitHub` — lecture : `tete()` (GraphQL), `arbre()` (REST git/trees récursif), `textes()` (GraphQL, 50 blobs par requête) ; écriture : `enregistrer()` via `createCommitOnBranch` (refus si `expectedHeadOid` a bougé), repli automatique sur l'API Git REST. `js/demo.js` : `SourceDemo`, même interface, stockée sur l'appareil.
- `js/depot.js` : `Depot` — cache IndexedDB par empreinte Git, index des pages / liens / pages liées / catégories / alias, `publier`, `renommer` (corrige les liens dans le même commit), `supprimer`. Après un commit, les empreintes sont calculées localement (rien à retélécharger).
- `js/app.js` : routes en hash (`#/page/Titre`, `#/modifier/…`, `#/historique/…`, `#/version/…/sha`, `#/diff/…/a/b`, `#/categorie/…`, `#/special/…`, `#/recherche/…`, `#/reglages`, `#/aide`). Chaque vue renvoie `{rafraichir, quitter}`.

## Tests
`tests/lancer.sh` lance un serveur local puis 4 scénarios Playwright (`demo`, `github`, `securite`, `hors-ligne`). `tests/faux-github.cjs` simule api.github.com (dépôt Git en mémoire, vraies empreintes SHA-1) et valide chaque requête GraphQL contre le schéma public de GitHub (`@octokit/graphql-schema`). Lancer les tests avant chaque envoi.
