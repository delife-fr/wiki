/* WIKI — page d'aide intégrée (toujours disponible, même sans dépôt). */

export const AIDE = `Chaque page du wiki est un fichier texte (Markdown) dans le dossier \`articles\` de ton dépôt privé. Le nom du fichier est le titre de la page : \`Voyage en Islande.md\` donne la page « Voyage en Islande ».

## Mise en forme
| Tu écris | Tu obtiens |
|---|---|
| \`**gras**\` | **gras** |
| \`*italique*\` | *italique* |
| \`## Titre de section\` | une section (et une entrée du sommaire) |
| \`### Sous-section\` | une sous-section |
| \`- élément\` | une liste à puces |
| \`1. élément\` | une liste numérotée |
| \`> citation\` | une citation |
| \`[texte](https://exemple.fr)\` | un lien vers un site |

Un retour à la ligne compte ; une ligne vide commence un nouveau paragraphe.

## Liens entre les pages
- \`[[Voyage en Islande]]\` : lien vers la page « Voyage en Islande ».
- \`[[Voyage en Islande|mon voyage]]\` : même lien, avec un autre texte affiché.
- \`[[Voyage en Islande#Itinéraire]]\` : lien vers une section de la page.
- Un lien vers une page qui n'existe pas encore s'affiche **en rouge** : un clic la crée.

Pendant l'écriture, tape \`[[\` : l'appli propose les titres existants.

Les majuscules ne comptent pas dans les liens : \`[[voyage en islande]]\` mène à la même page.

## Photos et fichiers
Dans l'éditeur, le bouton **Photo** ajoute une photo. Elle est réduite automatiquement, rangée dans le dossier \`medias\` et insérée ainsi :
- \`![[kyoto.jpg]]\` : la photo en vignette, à droite du texte.
- \`![[kyoto.jpg|Le temple de Kyoto]]\` : avec une légende.
- \`![[kyoto.jpg|Le temple|300]]\` : avec une largeur de 300 pixels.
- \`![[kyoto.jpg|gauche]]\`, \`|centre\` ou \`|pleine\` : position de la photo.

Un clic sur une photo l'affiche en grand. Un PDF s'insère de la même façon et s'affiche comme un lien à télécharger.

## Notes et références
\`\`\`
Il est né à Lyon[^1].

[^1]: Acte de naissance, mairie de Lyon.
\`\`\`
Les notes sont numérotées et regroupées en bas de la page, sous « Notes et références ».

## Bloc d'infos et encadré
Les lignes entre deux \`---\`, tout en haut du fichier, forment le **bloc d'infos**. Elles s'affichent dans l'encadré à droite de l'article :
\`\`\`
---
date: Juillet 2024
lieu: "[[Islande]]"
avec:
  - "[[Camille]]"
  - "[[Sam]]"
image: islande.jpg
legende: Le glacier de Vatnajökull
categories: [Voyages, 2024]
aliases: [Road trip en Islande]
---
\`\`\`
- Chaque ligne \`nom: valeur\` devient une ligne de l'encadré. Une liste (\`- élément\`) donne plusieurs valeurs.
- Mets les liens \`[[ ]]\` **entre guillemets** dans ce bloc.
- \`image\` et \`legende\` : la photo en haut de l'encadré.
- \`categories\` : les catégories de la page, en bas de l'article (\`tags\` marche aussi).
- \`aliases\` : d'autres noms pour la page. Un lien vers un alias mène à la page (comme une redirection).

## Sections spéciales
- **Pages qui mènent ici** : en bas de chaque article, les pages qui ont un lien vers lui.
- **Historique** : chaque modification est gardée par GitHub. Tu peux voir une ancienne version, la comparer à la précédente ou la restaurer.
- **Pages demandées** : les liens rouges du wiki, avec le nombre de pages qui les citent.
- **Pages orphelines** : les pages vers lesquelles aucun lien ne mène.

## Brouillons et hors ligne
- Ce que tu écris est gardé sur l'appareil au fur et à mesure : si tu quittes l'éditeur sans publier, le brouillon est repris à la prochaine ouverture.
- Sans réseau, le wiki reste lisible (dernière copie). Pour publier, il faut le réseau.
- Si la page a été modifiée ailleurs pendant que tu écrivais, l'appli te prévient au lieu d'écraser l'autre version.

## Avec Obsidian
Le format est celui d'[Obsidian](https://obsidian.md) : le dépôt \`wiki-donnees\` peut aussi s'ouvrir comme un coffre Obsidian, avec les mêmes liens, photos et blocs d'infos.
`;
