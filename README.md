# Wiki DELIFE

Un wiki personnel : la structure de Wikipédia, l'apparence de LIFE PANEL (thème sombre ou clair). L'appli est ici (dépôt public) ; **le contenu est dans un dépôt privé** (`delife-fr/wiki-donnees`) qu'elle lit et modifie avec une clé GitHub gardée dans le navigateur.

- Une page = un fichier Markdown (`articles/Voyage au Japon.md`), liées par des `[[liens]]`.
- Liens rouges vers les pages à écrire, « pages qui mènent ici », catégories, encadré d'infos, sommaire, notes de bas de page.
- Photos réduites automatiquement et envoyées avec la page.
- Historique de chaque page, différences entre deux versions, restauration.
- Recherche dans tout le texte (tolère les fautes de frappe).
- S'ouvre hors ligne ; s'installe sur l'écran d'accueil du téléphone.
- Format compatible avec [Obsidian](https://obsidian.md).

## Mise en route

1. **Publier l'appli** : dans ce dépôt, *Settings* → *Pages* → *Source* : *Deploy from a branch*, branche `main`, dossier `/ (root)`, puis *Save*. L'appli sera à l'adresse `https://delife-fr.github.io/wiki/`.
2. **Créer la clé** : [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   - *Repository access* : *Only select repositories* → `wiki-donnees` seulement ;
   - *Permissions* → *Repository permissions* → *Contents* : *Read and write* ;
   - *Generate token* et copier la clé (`github_pat_…`).
3. **Ouvrir l'appli** → *Réglages* → coller la clé → *Enregistrer et se connecter*.
4. **Sur iPhone** : dans Safari, bouton *Partager* → *Sur l'écran d'accueil*.

Sans clé, le bouton *Essayer la démo* montre le wiki avec des pages d'exemple gardées sur l'appareil.

## Comment ça marche

| Partie | Rôle |
|---|---|
| `index.html`, `css/wiki.css` | page unique et mise en page |
| `js/app.js` | démarrage, navigation (`#/page/Titre`), recherche de l'en-tête, état de synchronisation |
| `js/vues.js`, `js/editeur.js` | les écrans : article, éditeur, historique, catégories, pages spéciales, réglages |
| `js/depot.js` | le contenu connu de l'appli : pages, liens, catégories, photos ; synchronisation et écritures |
| `js/github.js` | accès à GitHub : lecture groupée (GraphQL, 50 articles par demande), écriture en un commit, repli automatique sur l'API REST |
| `js/rendu.js`, `js/analyse.js` | Markdown → page (marked + DOMPurify), liens `[[ ]]`, encadré, sommaire |
| `js/recherche.js` | suggestions et recherche (MiniSearch) |
| `js/stockage.js`, `js/medias.js` | copie sur l'appareil (IndexedDB), photos |
| `js/demo.js` | mode démo |
| `sw.js` | ouverture hors ligne |
| `vendor/bibliotheques.js` | marked, marked-footnote, DOMPurify, MiniSearch, js-yaml (versions figées, licences dans `vendor/LICENCES.txt`) |

Chargement : une petite demande vérifie le dernier commit ; si rien n'a changé, tout vient de l'appareil. Sinon, seuls les articles modifiés sont téléchargés. Écriture : un seul commit par action (page + photos, ou renommage + liens corrigés) ; si le dépôt a changé entre-temps, rien n'est écrasé.

Sécurité : le contenu affiché est nettoyé par DOMPurify et la page interdit tout script extérieur (Content-Security-Policy). La clé n'est envoyée qu'à `api.github.com`.

## Développement

Pas d'étape de compilation : on modifie les fichiers, on les envoie sur `main`, GitHub Pages les publie.

- À chaque nouvelle version : changer `VERSION` dans `sw.js` **et** dans `js/reglages.js` (sinon les téléphones gardent l'ancienne copie). Un nouveau fichier JS doit aussi être ajouté à la liste `FICHIERS` de `sw.js`.
- Changer de version d'une bibliothèque : modifier `outils/vendor/package.json`, puis lancer `outils/vendor/construire.sh`.
- Tests (Chromium, avec un faux GitHub qui vérifie chaque requête GraphQL contre le schéma officiel) : `tests/lancer.sh`.
