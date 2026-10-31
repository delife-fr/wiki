/* WIKI — recherche.
   · Suggestions pendant la frappe : sur les titres et les alias, instantané.
   · Recherche dans le texte : MiniSearch (tolère les fautes de frappe et les mots incomplets). Son index n'est
     préparé qu'à la première recherche, puis refait seulement si le wiki a changé. */

import {MiniSearch} from '../vendor/bibliotheques.js';
import {texteBrut, liste} from './analyse.js';
import {esc, pourRecherche, comparer} from './outils.js';

let index = null, versionIndex = -1, depotIndex = null;
const brut = new WeakMap();

const texteDe = p => {
  if (!brut.has(p)) brut.set(p, texteBrut(p.corps).normalize('NFC'));
  return brut.get(p);
};

function preparer(depot) {
  if (index && versionIndex === depot.version && depotIndex === depot) return index;
  index = new MiniSearch({
    idField: 'titre',
    fields: ['titre', 'alias', 'categories', 'infos', 'texte'],
    storeFields: ['titre'],
    processTerm: t => { const x = pourRecherche(t); return x.length > 1 || /\d/.test(x) ? x : null; },
    searchOptions: {boost: {titre: 5, alias: 4, categories: 2, infos: 1.5}, prefix: true, fuzzy: 0.2, combineWith: 'AND'},
  });
  index.addAll([...depot.pages.values()].map(p => ({
    titre: p.titre, alias: p.alias.join(' '), categories: p.categories.join(' '),
    infos: Object.values(p.infos).flatMap(liste).join(' '), texte: texteDe(p),
  })));
  versionIndex = depot.version; depotIndex = depot;
  return index;
}

export function rechercher(depot, q) {
  if (!q.trim()) return [];
  const res = preparer(depot).search(q);
  return res.map(r => ({page: depot.page(r.id), score: r.score, termes: r.terms})).filter(r => r.page);
}

/* Titres (et alias) qui contiennent ce qui est tapé ; ceux qui commencent par la saisie d'abord. */
export function suggestions(depot, q, max = 8) {
  const s = pourRecherche(q.trim());
  if (!s) return [];
  const res = [];
  for (const p of depot.pages.values()) {
    const t = pourRecherche(p.titre);
    let rang = t.startsWith(s) ? 0 : t.split(/[\s'’-]+/).some(m => m.startsWith(s)) ? 1 : t.includes(s) ? 2 : -1;
    let via = null;
    if (rang < 0) for (const a of p.alias) {
      const x = pourRecherche(a);
      if (x.includes(s)) { rang = x.startsWith(s) ? 1 : 3; via = a; break; }
    }
    if (rang >= 0) res.push({page: p, rang, via});
  }
  return res.sort((a, b) => a.rang - b.rang || comparer(a.page.titre, b.page.titre)).slice(0, max);
}

/* Extrait du texte autour du premier mot trouvé, mots surlignés. */
export function extrait(page, termes, longueur = 220) {
  const texte = texteDe(page), comparable = pourRecherche(texte);
  const mots = [...new Set(termes.map(pourRecherche))].filter(Boolean).sort((a, b) => b.length - a.length);
  let debut = 0;
  for (const m of mots) { const i = comparable.indexOf(m); if (i >= 0) { debut = Math.max(0, i - 60); break; } }
  if (debut > 0) { const espace = texte.indexOf(' ', debut); if (espace > 0 && espace - debut < 20) debut = espace + 1; }
  const fin = Math.min(texte.length, debut + longueur);
  const morceau = texte.slice(debut, fin), comp = comparable.slice(debut, fin);
  const marques = [];
  for (const m of mots) {
    let i = 0;
    while ((i = comp.indexOf(m, i)) >= 0) { marques.push([i, i + m.length]); i += m.length; }
  }
  marques.sort((a, b) => a[0] - b[0]);
  let html = '', pos = 0;
  for (const [a, b] of marques) {
    if (a < pos) continue;
    html += esc(morceau.slice(pos, a)) + '<mark>' + esc(morceau.slice(a, b)) + '</mark>';
    pos = b;
  }
  html += esc(morceau.slice(pos));
  return (debut > 0 ? '… ' : '') + html + (fin < texte.length ? ' …' : '');
}
