/* WIKI — lecture d'un article : bloc d'infos (YAML en tête du fichier), liens [[ ]], catégories, alias, texte brut.
   Le format est celui d'Obsidian : un dossier de fichiers Markdown ouvert dans Obsidian s'affiche pareil ici. */

import {chargerYaml} from '../vendor/bibliotheques.js';
import {estImage, extension, titreDepuisChemin} from './outils.js';

const BLOC_INFOS = /^﻿?---[ \t]*\r?\n((?:[\s\S]*?\r?\n)?)(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

export function separer(texte) {
  const m = BLOC_INFOS.exec(texte);
  if (!m) return {infos: {}, corps: texte, erreur: null};
  let infos = {}, erreur = null;
  try {
    const v = chargerYaml(m[1]);
    if (v && typeof v === 'object' && !Array.isArray(v)) infos = v;
    else if (v != null) erreur = 'Le bloc d’infos doit être une liste de lignes « nom: valeur ».';
  } catch (e) {
    erreur = String(e.message || e).split('\n')[0];
  }
  return {infos, corps: texte.slice(m[0].length), erreur};
}

/* Valeur YAML → liste de textes. `lieu: [[Paris]]` sans guillemets donne [["Paris"]] en YAML : on le comprend comme un lien. */
export function liste(v) {
  if (v == null || v === '') return [];
  const brut = Array.isArray(v) ? v : [v];
  return brut.flatMap(x => Array.isArray(x) ? (x.length === 1 && !Array.isArray(x[0]) ? [`[[${x[0]}]]`] : liste(x)) : [x])
    .map(x => (x instanceof Date ? x.toISOString().slice(0, 10) : String(x)).trim()).filter(Boolean);
}

const nettoyerNom = s => s.replace(/^\[\[|\]\]$/g, '').replace(/^#/, '').trim();

export function categoriesDe(infos) {
  const vues = new Set(), res = [];
  for (const k of ['categories', 'catégories', 'categorie', 'catégorie', 'tags']) {
    for (const c of liste(infos[k]).map(nettoyerNom)) {
      const n = c.toLocaleLowerCase('fr');
      if (c && !vues.has(n)) { vues.add(n); res.push(c); }
    }
  }
  return res;
}

export const aliasDe = infos => liste(infos.aliases ?? infos.alias).map(nettoyerNom).filter(Boolean);

/* Clés du bloc d'infos qui ne s'affichent pas dans l'encadré. */
export const CLES_SPECIALES = new Set(['categories', 'catégories', 'categorie', 'catégorie', 'tags', 'aliases', 'alias',
  'image', 'legende', 'légende', 'cssclasses', 'cssclass', 'publish', 'titre']);

const SANS_CODE = t => t.replace(/^(```|~~~)[\s\S]*?^\1/gm, ' ').replace(/`[^`\n]*`/g, ' ');
const LIEN = /(!?)\[\[([^[\]\n|]+?)(?:\|[^[\]\n]*)?\]\]/g;

/* Titres visés par les liens d'un texte (sans les photos ni les fichiers). */
export function extraireLiens(texte) {
  const res = [], propre = SANS_CODE(texte);
  for (const m of propre.matchAll(LIEN)) {
    const cible = m[2].split('#')[0].trim();
    if (!cible || (m[1] && extension(cible))) continue;
    res.push(cible);
  }
  for (const m of propre.matchAll(/\]\(<?([^)\s>]+\.md)>?(?:#[^)]*)?\)/gi)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(m[1])) continue;
    try { res.push(titreDepuisChemin(decodeURIComponent(m[1]))); } catch { /* adresse mal formée */ }
  }
  return res;
}

/* Texte sans mise en forme : pour la recherche et les extraits. */
export const texteBrut = corps => SANS_CODE(corps)
  .replace(/!\[\[[^\]]*\]\]/g, ' ')
  .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
  .replace(/\[\[([^\]]+)\]\]/g, '$1')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/\[\^[^\]]+\]:?/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/^\s*(?:[-+*]|\d+\.)\s+/gm, '')
  .replace(/[#>*_`~|]+/g, ' ')
  .replace(/\s+/g, ' ').trim();

/* Analyse complète d'un fichier article. */
export function analyser(chemin, sha, texte) {
  const titre = titreDepuisChemin(chemin);
  const {infos, corps, erreur} = separer(texte);
  return {
    titre, chemin, sha, texte, infos, corps, erreur,
    liens: extraireLiens(texte),
    categories: categoriesDe(infos),
    alias: aliasDe(infos),
    image: infos.image ? nettoyerNom(String(liste(infos.image)[0] || '').replace(/^!/, '')) : null,
  };
}

export const estMediaAffichable = nom => estImage(nom);
