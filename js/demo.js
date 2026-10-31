/* WIKI — mode démo : un faux dépôt gardé sur l'appareil, avec quelques pages d'exemple.
   Même fonctionnement que SourceGitHub (lecture, commits, historique), sans réseau ni clé. */

import {empreinteGit, texteVersOctets} from './outils.js';
import {lire, ecrire} from './stockage.js';
import {ErreurGitHub} from './github.js';

const CLE = 'demo';

const PAGES = {
  'articles/Accueil.md': `Bienvenue sur la **démo du wiki**. Ces pages sont des exemples : modifie-les, crée-en d'autres, tout reste sur cet appareil.

## Pour commencer
- Ouvre l'article [[Voyage en Islande]] pour voir un article complet : encadré d'infos, sommaire, notes et catégories.
- Un lien vers une page qui n'existe pas encore s'affiche [[Page à écrire|en rouge]] : un clic la crée.
- La syntaxe complète est expliquée dans l'[aide](#/aide) (menu de gauche).

## Quand tu es prêt
Va dans les **Réglages** et colle ta clé GitHub : le wiki affichera alors ton propre contenu.
`,
  'articles/Voyage en Islande.md': `---
image: islande.svg
legende: Itinéraire autour de l'île
date: Juillet 2024
durée: 12 jours
lieu: "[[Islande]]"
avec:
  - "[[Camille]]"
  - "[[Sam]]"
categories: [Voyages, 2024]
---
Le **voyage en Islande** est un road trip de douze jours effectué en juillet 2024 autour de l'île par la route n° 1[^route].

## Préparation
Le voyage est décidé au printemps, après un reportage sur les fjords de l'Est. La voiture est louée à Reykjavik.

## Itinéraire
| Jours | Étape |
|---|---|
| 1 à 3 | Reykjavik et le Cercle d'or |
| 4 à 7 | Côte sud, glacier de Vatnajökull |
| 8 à 12 | Fjords de l'Est, Mývatn, retour |

### Moments marquants
- Une baignade dans une source chaude au milieu de nulle part.
- Le soleil de minuit vu depuis le camping de Höfn.

## Souvenirs
> « On a roulé deux heures sans croiser une seule voiture. »

Voir aussi [[Camille]] et [[Voyages|la liste des voyages]].

[^route]: La route n° 1, appelée *Hringvegur*, fait le tour de l'île sur environ 1 300 km.
`,
  'articles/Camille.md': `---
categories: [Personnes]
rencontre: 2019
---
**Camille** est une amie rencontrée en 2019. Elle a participé au [[Voyage en Islande]].
`,
  'articles/Voyages.md': `---
categories: [Voyages]
aliases: [Liste des voyages]
---
Liste des voyages :
- [[Voyage en Islande]] (2024)
- [[Week-end à Lisbonne]] (à écrire)
`,
  'medias/islande.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260"><rect width="400" height="260" fill="#cfe3f3"/><path d="M60 120c20-40 70-60 120-55s70-30 110-15 60 40 50 75-40 60-90 65-80 25-130 10-80-40-60-80z" fill="#e8efe4" stroke="#6b8f71" stroke-width="3"/><path d="M95 150c40 10 70-20 110-15s60 35 95 20" fill="none" stroke="#d33" stroke-width="4" stroke-dasharray="8 6"/><circle cx="95" cy="150" r="7" fill="#36c"/><text x="105" y="175" font-family="sans-serif" font-size="14" fill="#202122">Reykjavik</text></svg>
`,
};

const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), b => b.toString(16).padStart(2, '0')).join('');

export class SourceDemo {
  constructor() { this.nom = 'démo'; this.etat = null; }

  async charger() {
    if (this.etat) return this.etat;
    this.etat = await lire('etat', CLE);
    if (!this.etat) {
      const fichiers = {};
      for (const [chemin, texte] of Object.entries(PAGES)) {
        const octets = texteVersOctets(texte);
        fichiers[chemin] = {sha: await empreinteGit(octets), donnees: texte, type: chemin.endsWith('.svg') ? 'image/svg+xml' : 'text/markdown'};
      }
      const commit = hex();
      this.etat = {tete: commit, fichiers, commits: [{sha: commit, date: new Date().toISOString(), auteur: 'démo', message: 'Pages d\'exemple',
        changes: Object.keys(fichiers).map(chemin => ({chemin, etat: 'added', sha: fichiers[chemin].sha}))}], blobs: {}};
      for (const f of Object.values(fichiers)) this.etat.blobs[f.sha] = f.donnees;
      await ecrire('etat', CLE, this.etat);
    }
    return this.etat;
  }

  async tete() { const e = await this.charger(); return {commit: e.tete, arbre: e.tete}; }

  async arbre() {
    const e = await this.charger();
    return Object.entries(e.fichiers).map(([chemin, f]) => ({chemin, sha: f.sha, taille: typeof f.donnees === 'string' ? f.donnees.length : f.donnees.size}));
  }

  async textes(shas) {
    const e = await this.charger(), res = new Map();
    for (const s of shas) {
      const d = e.blobs[s];
      if (typeof d === 'string') res.set(s, d);
      else if (d) res.set(s, await d.text());
    }
    return res;
  }

  async media(sha) {
    const e = await this.charger(), d = e.blobs[sha];
    if (d === undefined) throw new ErreurGitHub('introuvable', 'Fichier introuvable dans la démo.');
    return typeof d === 'string' ? new Blob([d], {type: 'image/svg+xml'}) : d;
  }

  async enregistrer({teteAttendue, message, ajouts = [], suppressions = []}) {
    const e = await this.charger();
    if (teteAttendue !== e.tete) throw new ErreurGitHub('conflit', 'Le wiki a été modifié ailleurs entre-temps.');
    const changes = [];
    for (const a of ajouts) {
      const sha = await empreinteGit(a.octets);
      const texte = /\.(md|svg|txt)$/i.test(a.chemin);
      const donnees = texte ? new TextDecoder().decode(a.octets) : new Blob([a.octets], {type: a.type || 'application/octet-stream'});
      changes.push({chemin: a.chemin, etat: e.fichiers[a.chemin] ? 'modified' : 'added', sha});
      e.fichiers[a.chemin] = {sha, donnees};
      e.blobs[sha] = donnees;
    }
    for (const chemin of suppressions) { delete e.fichiers[chemin]; changes.push({chemin, etat: 'removed'}); }
    e.tete = hex();
    e.commits.unshift({sha: e.tete, date: new Date().toISOString(), auteur: 'démo', message, changes});
    await ecrire('etat', CLE, e);
    return {commit: e.tete, arbre: e.tete};
  }

  async historique(chemin) {
    const e = await this.charger();
    return e.commits.filter(c => c.changes.some(x => x.chemin === chemin)).map(({sha, date, auteur, message}) => ({sha, date, auteur, message}));
  }

  async version(chemin, commitSha) {
    const e = await this.charger();
    const i = e.commits.findIndex(c => c.sha === commitSha);
    if (i < 0) return null;
    for (const c of e.commits.slice(i)) {
      const x = c.changes.find(y => y.chemin === chemin);
      if (!x) continue;
      if (x.etat === 'removed') return null;
      const d = e.blobs[x.sha];
      return typeof d === 'string' ? d : d ? await d.text() : null;
    }
    return null;
  }

  async recentes(nombre = 30) {
    const e = await this.charger();
    return e.commits.slice(0, nombre).map(({sha, date, auteur, message}) => ({sha, date, auteur, message}));
  }

  async fichiersCommit(sha) {
    const e = await this.charger();
    return (e.commits.find(c => c.sha === sha)?.changes || []).map(({chemin, etat}) => ({chemin, etat}));
  }

  async reinitialiser() { this.etat = null; await ecrire('etat', CLE, null); }
}
