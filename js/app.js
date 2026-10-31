/* WIKI — démarrage, navigation, en-tête (recherche), menu, état de synchronisation, réglages. */

import {SourceGitHub} from './github.js';
import {SourceDemo} from './demo.js';
import {Depot} from './depot.js';
import {suggestions} from './recherche.js';
import {esc, heure, lienPage, decoderTitre} from './outils.js';
import {reglages, appliquerTheme} from './reglages.js';
import * as vues from './vues.js';
import {vueModifier} from './editeur.js';

function creerDepot(r) {
  if (r.mode === 'demo') {
    const s = new SourceDemo(); s.local = true;
    return new Depot(s, {dossierArticles: 'articles', dossierMedias: 'medias', cleCache: 'depot:demo'});
  }
  if (r.mode === 'github' && r.jeton) {
    const s = new SourceGitHub(r);
    return new Depot(s, {dossierArticles: r.dossierArticles, dossierMedias: r.dossierMedias, cleCache: `depot:${r.proprietaire}/${r.depot}@${r.branche}`});
  }
  return null;
}

/* ---------------------------------------------------------------- état partagé */

const app = {depot: null, vue: null, route: null, pret: false};
const $ = s => document.querySelector(s);

function annoncer(message, type = 'info', duree = 4000) {
  const t = document.createElement('div');
  t.className = 'toast ' + type; t.setAttribute('role', type === 'erreur' ? 'alert' : 'status');
  t.textContent = message;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('part'); setTimeout(() => t.remove(), 400); }, duree);
}

/* Change de dépôt (après les réglages ou pour la démo) et recharge tout. */
async function demarrerDepot() {
  app.depot?.ecouteurs.clear();
  app.depot = creerDepot(reglages());
  majStatut();
  if (!app.depot) { await rendreRoute(); return; }
  app.depot.surChangement(type => {
    if (type === 'statut') majStatut();
    if (type === 'change') rafraichirVue();
  });
  const enCache = await app.depot.demarrer();
  app.pret = enCache;
  await rendreRoute();
  try {
    await app.depot.synchroniser();
    if (!app.pret) { app.pret = true; await rendreRoute(); }
  } catch {
    if (!app.pret) await rendreRoute();
  }
}

/* ---------------------------------------------------------------- navigation */

const aller = h => { if (location.hash === h) rendreRoute(); else location.hash = h; };

function lireRoute() {
  const brut = location.hash.replace(/^#/, '');
  const i = brut.indexOf('#', 1);
  const chemin = i > 0 ? brut.slice(0, i) : brut, ancre = i > 0 ? brut.slice(i + 1) : '';
  const [, nom = '', ...params] = chemin.split('/');
  return {nom, params: params.map(decoderTitre), brut: params, ancre};
}

async function rendreRoute() {
  const main = $('#contenu');
  const r = lireRoute();
  app.route = r;
  if (app.vue?.quitter) app.vue.quitter();
  app.vue = null;
  document.body.classList.remove('menu-ouvert');
  fermerSuggestions();
  const d = app.depot;
  const ctx = {depot: d, main, annoncer, aller, route: r, demarrerDepot};
  try {
    if (r.nom === 'reglages') app.vue = vues.vueReglages(main, ctx);
    else if (r.nom === 'aide') app.vue = vues.vueAide(main, ctx);
    else if (!d) app.vue = vues.vueBienvenue(main, ctx);
    else if (!app.pret) app.vue = vues.vueChargement(main, ctx);
    else switch (r.nom) {
      case '': app.vue = vues.vueAccueil(main, ctx); break;
      case 'page': app.vue = r.params[0] ? vues.vueArticle(main, ctx, r.params[0]) : vues.vueAccueil(main, ctx); break;
      case 'modifier': app.vue = vueModifier(main, ctx, r.params[0] || ''); break;
      case 'historique': app.vue = vues.vueHistorique(main, ctx, r.params[0]); break;
      case 'version': app.vue = vues.vueVersion(main, ctx, r.params[0], r.brut[1]); break;
      case 'diff': app.vue = vues.vueDiff(main, ctx, r.params[0], r.brut[1], r.brut[2]); break;
      case 'categorie': app.vue = vues.vueCategorie(main, ctx, r.params[0]); break;
      case 'recherche': app.vue = vues.vueRecherche(main, ctx, r.params.join('/')); break;
      case 'renommer': app.vue = vues.vueRenommer(main, ctx, r.params[0]); break;
      case 'supprimer': app.vue = vues.vueSupprimer(main, ctx, r.params[0]); break;
      case 'special': app.vue = vues.vueSpeciale(main, ctx, r.params[0]); break;
      default: app.vue = vues.vueIntrouvable(main, ctx);
    }
  } catch (e) {
    console.error(e);
    main.innerHTML = `<h1 class="titre-page">Erreur</h1><div class="alerte erreur">Cette page n’a pas pu s’afficher : ${esc(e.message)}</div>`;
  }
  if (r.ancre) requestAnimationFrame(() => allerAncre(r.ancre, false));
  else if (!app.vue?.garderDefilement) window.scrollTo(0, 0);
  marquerMenu();
}

function rafraichirVue() {
  if (app.vue?.rafraichir) { app.vue.rafraichir(); return; }
  const y = window.scrollY;
  rendreRoute().then(() => window.scrollTo(0, y));
}

function allerAncre(id, doux = true) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({behavior: doux ? 'smooth' : 'auto', block: 'start'});
  el.classList.add('cible'); setTimeout(() => el.classList.remove('cible'), 2000);
}

function marquerMenu() {
  const h = location.hash || '#/';
  for (const a of document.querySelectorAll('#menu a')) a.classList.toggle('actif', a.getAttribute('href') === h);
}

/* ---------------------------------------------------------------- état de synchronisation */

function majStatut() {
  const el = $('#statut'), d = app.depot;
  if (!d) { el.innerHTML = ''; el.dataset.etat = ''; return; }
  const s = d.statut, quand = d.derniereSync ? heure(d.derniereSync) : '';
  const textes = {
    attente: 'Ouverture…',
    sync: s.message || 'Synchronisation…',
    ok: d.source.local ? 'Démo (sur cet appareil)' : `À jour${quand ? ' · ' + quand : ''}`,
    'hors-ligne': `Hors ligne${quand ? ' · copie de ' + quand : ''}`,
    erreur: s.message || 'Erreur',
  };
  el.dataset.etat = s.etat;
  el.innerHTML = `<span class="pastille" aria-hidden="true"></span><span class="texte">${esc(textes[s.etat] || '')}</span>
    ${s.etat !== 'sync' && !d.source.local ? '<button type="button" class="lien" id="actualiser">Actualiser</button>' : ''}`;
  $('#actualiser')?.addEventListener('click', () => d.synchroniser().catch(e => annoncer(e.message, 'erreur')));
}

/* ---------------------------------------------------------------- recherche (en-tête) */

let choix = -1, listeSugg = [];

function fermerSuggestions() { const u = $('#suggestions'); if (u) { u.hidden = true; u.innerHTML = ''; } choix = -1; listeSugg = []; }

function montrerSuggestions() {
  const q = $('#recherche').value, u = $('#suggestions');
  if (!q.trim() || !app.depot || !app.pret) { fermerSuggestions(); return; }
  const l = suggestions(app.depot, q, 7);
  listeSugg = [...l.map(s => ({href: lienPage(s.page.titre), html: `<span class="t">${esc(s.page.titre)}</span>${s.via ? `<span class="via">↪ ${esc(s.via)}</span>` : ''}`})),
    {href: '#/recherche/' + encodeURIComponent(q.trim()), html: `<span class="chercher">Rechercher les pages contenant <b>${esc(q.trim())}</b></span>`}];
  u.innerHTML = listeSugg.map((s, i) => `<li role="option" id="sugg-${i}"><a href="${esc(s.href)}">${s.html}</a></li>`).join('');
  u.hidden = false; choix = -1;
}

function validerRecherche() {
  const q = $('#recherche').value.trim();
  if (choix >= 0 && listeSugg[choix]) { aller(listeSugg[choix].href); }
  else if (q) {
    const p = app.depot?.page(q);
    aller(p ? lienPage(p.titre) : '#/recherche/' + encodeURIComponent(q));
  }
  $('#recherche').blur(); fermerSuggestions();
}

/* ---------------------------------------------------------------- démarrage */

function brancher() {
  window.addEventListener('hashchange', rendreRoute);
  $('#bouton-menu').addEventListener('click', () => document.body.classList.toggle('menu-ouvert'));
  $('#voile').addEventListener('click', () => document.body.classList.remove('menu-ouvert'));

  const champ = $('#recherche');
  champ.addEventListener('input', montrerSuggestions);
  champ.addEventListener('focus', montrerSuggestions);
  champ.addEventListener('keydown', e => {
    const u = $('#suggestions');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (u.hidden || !listeSugg.length) return;
      e.preventDefault();
      const n = listeSugg.length;
      choix = e.key === 'ArrowDown' ? (choix + 1 >= n ? -1 : choix + 1) : (choix <= -1 ? n - 1 : choix - 1);
      u.querySelectorAll('li').forEach((li, i) => li.classList.toggle('choisi', i === choix));
      champ.setAttribute('aria-activedescendant', choix >= 0 ? 'sugg-' + choix : '');
    } else if (e.key === 'Escape') { fermerSuggestions(); champ.blur(); }
  });
  $('#form-recherche').addEventListener('submit', e => { e.preventDefault(); validerRecherche(); });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#form-recherche')) fermerSuggestions(); });
  $('#suggestions').addEventListener('click', e => { if (e.target.closest('a')) { champ.value = ''; champ.blur(); fermerSuggestions(); } });

  /* ancres dans la page (sommaire, notes) : défilement sans changer de « page » */
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented) return;
    const h = a.getAttribute('href');
    if (h.startsWith('#/') || h === '#') return;
    e.preventDefault();
    allerAncre(decodeURIComponent(h.slice(1)));
  });

  /* photo en grand */
  document.addEventListener('click', e => {
    const img = e.target.closest('.corps .vignette img, .encadre img');
    if (!img || !img.src) return;
    const v = $('#visionneuse');
    v.querySelector('img').src = img.src; v.querySelector('img').alt = img.alt;
    v.querySelector('.legende').textContent = img.closest('.vignette')?.querySelector('.legende')?.textContent || img.alt || '';
    v.hidden = false; v.focus();
  });
  $('#visionneuse').addEventListener('click', () => { $('#visionneuse').hidden = true; });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { $('#visionneuse').hidden = true; document.body.classList.remove('menu-ouvert'); }
    if (e.key === '/' && !e.target.closest('input, textarea, [contenteditable]')) { e.preventDefault(); champ.focus(); }
  });

  document.addEventListener('visibilitychange', () => {
    const d = app.depot;
    if (document.visibilityState === 'visible' && d && Date.now() - d.derniereSync > 30000) d.synchroniser().catch(() => {});
  });
  window.addEventListener('online', () => app.depot?.synchroniser().catch(() => {}));
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => appliquerTheme(reglages().theme));
}

function serviceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const dejaControle = !!navigator.serviceWorker.controller;   /* faux à la toute première ouverture : pas de bandeau */
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nouveau = reg.installing;
      nouveau?.addEventListener('statechange', () => {
        if (nouveau.state === 'activated' && dejaControle) {
          const b = $('#mise-a-jour'); b.hidden = false;
        }
      });
    });
  }).catch(() => {});
  $('#mise-a-jour button').addEventListener('click', () => location.reload());
}

appliquerTheme(reglages().theme);
brancher();
serviceWorker();
demarrerDepot();
