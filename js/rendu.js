/* WIKI — Markdown → page affichée.
   marked fait la conversion, DOMPurify nettoie le résultat (un article ne peut exécuter aucun code), puis
   l'appli ajoute ce qui est propre au wiki : liens [[ ]] bleus ou rouges, photos ![[ ]], sommaire, encadré d'infos. */

import {Marked, markedFootnote, DOMPurify} from '../vendor/bibliotheques.js';
import {ancre, esc, estImage, extension, lienPage, encoderTitre} from './outils.js';
import {CLES_SPECIALES, liste} from './analyse.js';

let contexte = {depot: null, titre: '', sections: [], ids: new Map()};

/* [[Page]], [[Page|texte]], [[Page#Section]], [[#Section]], ![[photo.jpg]], ![[photo.jpg|légende|250]] */
const extensionLiens = {
  extensions: [{
    name: 'lienWiki', level: 'inline',
    start(src) { const i = src.search(/!?\[\[/); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^(!?)\[\[([^[\]\n|]+?)(?:\|([^[\]\n]*))?\]\]/.exec(src);
      if (m) return {type: 'lienWiki', raw: m[0], image: !!m[1], cible: m[2].trim(), option: m[3]?.trim() ?? null};
    },
    renderer(t) {
      if (t.image && extension(t.cible)) return `<span class="media" data-media="${esc(t.cible)}" data-option="${esc(t.option ?? '')}"></span>`;
      const [nom, section] = t.cible.split('#').map(s => s?.trim());
      const texte = t.option || (section ? (nom ? `${nom} § ${section}` : section) : nom);
      if (!nom) return `<a href="#${esc(ancre(section || ''))}" class="ancre">${esc(texte)}</a>`;
      const {page} = contexte.depot?.trouver(nom) ?? {};
      if (page) return `<a href="${esc(lienPage(page.titre, section))}" class="wl" data-titre="${esc(page.titre)}">${esc(texte)}</a>`;
      return `<a href="#/modifier/${esc(encoderTitre(nom))}" class="wl nouveau" title="${esc(nom)} (page inexistante)">${esc(texte)}</a>`;
    },
  }],
};

/* Titres de section avec un identifiant, pour le sommaire et les liens [[Page#Section]]. */
const extensionTitres = {
  renderer: {
    heading({tokens, depth, text}) {
      let id = ancre(text.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2'));
      const n = contexte.ids.get(id) || 0;
      contexte.ids.set(id, n + 1);
      if (n) id += '-' + (n + 1);
      const html = this.parser.parseInline(tokens);
      if (depth >= 2 && depth <= 4) contexte.sections.push({niveau: depth, id, html});
      return `<h${depth} id="${id}">${html}</h${depth}>\n`;
    },
  },
};

const mdArticle = new Marked({gfm: true, breaks: true})
  .use(markedFootnote({description: 'Notes et références', refMarkers: true, headingClass: 'titre-notes', backRefLabel: 'Retour à l’appel {0}'}))
  .use(extensionLiens, extensionTitres);
const mdLigne = new Marked({gfm: true, breaks: true}).use(extensionLiens);

const PURIFIER = {ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed'], FORBID_ATTR: ['style']};
export const nettoyer = html => DOMPurify.sanitize(html, PURIFIER);

/* Rend le corps d'un article. Renvoie {html, sections}. */
export function rendreCorps(corps, depot, titre = '') {
  contexte = {depot, titre, sections: [], ids: new Map()};
  let html;
  try { html = mdArticle.parse(corps); }
  catch (e) { html = `<pre>${esc(corps)}</pre>`; console.error(e); }
  return {html: nettoyer(html), sections: contexte.sections};
}

export function rendreLigne(texte, depot) {
  contexte = {depot, titre: '', sections: [], ids: new Map()};
  try { return nettoyer(mdLigne.parseInline(String(texte))); } catch { return esc(texte); }
}

/* Encadré d'infos (à droite, comme sur Wikipédia) : toutes les clés du bloc d'infos sauf les clés spéciales. */
export function rendreEncadre(page, depot) {
  const lignes = Object.entries(page.infos).filter(([k, v]) => !CLES_SPECIALES.has(k.toLowerCase()) && !k.startsWith('_') && v != null && v !== '' && !(Array.isArray(v) && !v.length));
  if (!lignes.length && !page.image) return '';
  const nomCle = k => esc(k.charAt(0).toUpperCase() + k.slice(1).replace(/[_-]+/g, ' '));
  const valeur = v => {
    if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) return Object.entries(v).map(([a, b]) => `${nomCle(a)} : ${valeur(b)}`).join('<br>');
    const l = liste(v);
    return l.length > 1 ? '<ul>' + l.map(x => `<li>${rendreLigne(x, depot)}</li>`).join('') + '</ul>' : rendreLigne(l[0] ?? '', depot);
  };
  const legende = page.infos.legende ?? page.infos['légende'];
  return `<aside class="encadre" aria-label="Infos">
    <div class="encadre-titre">${esc(page.titre)}</div>
    ${page.image ? `<div class="encadre-image"><span class="media" data-media="${esc(page.image)}" data-option="encadre"></span>${legende ? `<div class="encadre-legende">${rendreLigne(legende, depot)}</div>` : ''}</div>` : ''}
    ${lignes.length ? `<table><tbody>${lignes.map(([k, v]) => `<tr><th scope="row">${nomCle(k)}</th><td>${valeur(v)}</td></tr>`).join('')}</tbody></table>` : ''}
  </aside>`;
}

export function rendreSommaire(sections) {
  if (sections.length < 3) return '';
  const compteurs = [0, 0, 0];
  const min = Math.min(...sections.map(s => s.niveau));
  const items = sections.map(s => {
    const niv = Math.min(s.niveau - min, 2);
    compteurs[niv]++;
    for (let i = niv + 1; i < 3; i++) compteurs[i] = 0;
    const num = compteurs.slice(0, niv + 1).join('.');
    return `<li class="niv-${niv}"><a href="#${s.id}"><span class="num">${num}</span> ${s.html.replace(/<a [^>]*>|<\/a>/g, '')}</a></li>`;
  }).join('');
  return `<nav class="sommaire" aria-label="Sommaire"><details open><summary>Sommaire</summary><ol>${items}</ol></details></nav>`;
}

/* Finitions dans la page affichée : liens externes, tableaux qui défilent, photos.
   urlMedia(entrée) → promesse d'adresse blob:, attente → photos en attente d'envoi (éditeur). */
export function finaliser(racine, depot, {urlMedia, attente = new Map()} = {}) {
  for (const a of racine.querySelectorAll('a[href]')) {
    const h = a.getAttribute('href');
    if (/^https?:\/\//i.test(h)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; a.classList.add('externe'); }
    else if (/^(?!#|[a-z][a-z0-9+.-]*:).+\.md(#.*)?$/i.test(h)) {
      /* lien Markdown vers un autre article : [texte](Autre page.md) */
      try {
        const [f, s] = h.split('#'), nom = decodeURIComponent(f.split('/').pop().replace(/\.md$/i, ''));
        const {page} = depot.trouver(nom);
        a.setAttribute('href', page ? lienPage(page.titre) + (s ? '#' + s : '') : '#/modifier/' + encoderTitre(nom));
        a.classList.add('wl'); if (!page) a.classList.add('nouveau');
      } catch { /* adresse mal formée : laissée telle quelle */ }
    }
  }
  for (const t of racine.querySelectorAll('.corps table')) {
    if (t.parentElement.classList.contains('defile')) continue;
    const d = document.createElement('div'); d.className = 'defile';
    t.replaceWith(d); d.appendChild(t);
  }
  for (const el of racine.querySelectorAll('span.media')) afficherMedia(el, depot, urlMedia, attente);
}

function afficherMedia(el, depot, urlMedia, attente) {
  const nom = el.dataset.media, opts = (el.dataset.option || '').split('|').map(s => s.trim()).filter(Boolean);
  let largeur = null, position = '', legende = '';
  for (const o of opts) {
    if (/^\d{2,4}(x\d{2,4})?$/.test(o)) largeur = parseInt(o, 10);
    else if (['gauche', 'droite', 'centre', 'pleine', 'encadre'].includes(o.toLowerCase())) position = o.toLowerCase();
    else legende = o;
  }
  const enAttente = attente.get(nom.toLowerCase());
  const entree = enAttente ? null : depot.media(nom);
  el.textContent = '';
  if (!enAttente && !entree) {
    el.className = 'media manquant';
    el.innerHTML = `<span>Fichier introuvable : ${esc(nom)}</span>`;
    return;
  }
  if (!estImage(nom)) {
    const a = document.createElement('a');
    a.className = 'fichier'; a.textContent = '📄 ' + (legende || nom); a.href = '#'; a.dataset.telecharger = nom;
    a.addEventListener('click', async ev => {
      ev.preventDefault();
      const u = enAttente ? enAttente.url : await urlMedia(entree);
      const l = document.createElement('a'); l.href = u; l.download = nom; l.click();
    });
    el.className = 'media lien-fichier'; el.appendChild(a);
    return;
  }
  el.className = 'media vignette' + (position ? ' ' + position : '') + (legende ? ' avec-legende' : '');
  const img = document.createElement('img');
  img.alt = legende || nom; img.loading = 'lazy'; img.decoding = 'async';
  if (largeur) el.style.width = Math.min(largeur, 2000) + 'px';
  el.appendChild(img);
  if (legende) { const c = document.createElement('span'); c.className = 'legende'; c.innerHTML = rendreLigne(legende, depot); el.appendChild(c); }
  el.dataset.nom = nom;
  if (enAttente) { img.src = enAttente.url; return; }
  el.classList.add('chargement');
  urlMedia(entree).then(u => { img.src = u; el.classList.remove('chargement'); })
    .catch(() => { el.classList.remove('chargement'); el.classList.add('erreur'); img.alt = 'Photo non chargée : ' + nom; });
}
