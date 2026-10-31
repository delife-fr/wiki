/* WIKI — les écrans (sauf l'éditeur, dans editeur.js).
   Chaque vue remplit `main` et peut renvoyer {rafraichir, quitter, garderDefilement}. */

import {rendreCorps, rendreEncadre, rendreSommaire, finaliser} from './rendu.js';
import {analyser} from './analyse.js';
import {urlMedia} from './medias.js';
import {rechercher, extrait, suggestions} from './recherche.js';
import {differences, rendreDifferences} from './diff.js';
import {AIDE} from './aide.js';
import {reglages, enregistrerReglages, appliquerTheme, VERSION} from './reglages.js';
import {toutVider} from './stockage.js';
import {esc, lienPage, encoderTitre, dateHeure, pluriel, comparer, verifierTitre, local, cle, attendre} from './outils.js';

const titreDoc = t => { document.title = t ? `${t} — Wiki` : 'Wiki'; };
const optionsFinaliser = depot => ({urlMedia: e => urlMedia(depot, e)});
const cacheInfosCommits = new Map();   /* empreinte de commit → {date, auteur, message} */
const cacheFichiersCommits = new Map();

export function onglets(titre, actif, existe = true) {
  const t = encoderTitre(titre);
  const o = (id, href, texte) => `<a href="${href}"${actif === id ? ' class="actif" aria-current="page"' : ''}>${texte}</a>`;
  return `<div class="onglets">
    <nav class="onglets-gauche" aria-label="Espace">${o(actif === 'lire' || actif === 'version' ? actif : '', lienPage(titre), 'Article')}</nav>
    <nav class="onglets-droite" aria-label="Actions">
      ${existe ? o('lire', lienPage(titre), 'Lire') : ''}
      ${o('modifier', '#/modifier/' + t, existe ? 'Modifier' : 'Créer')}
      ${o('historique', '#/historique/' + t, 'Historique')}
      ${existe ? `<details class="plus"><summary aria-label="Plus d’actions">⋯</summary><div class="plus-menu">
        <a href="#/renommer/${t}">Renommer</a><a href="#/supprimer/${t}">Supprimer</a></div></details>` : ''}
    </nav>
  </div>`;
}

const groupesParLettre = titres => {
  const g = new Map();
  for (const t of [...titres].sort(comparer)) {
    const l = t.charAt(0).normalize('NFD').charAt(0).toUpperCase();
    const k = /[A-Z]/.test(l) ? l : /[0-9]/.test(l) ? '0–9' : '#';
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(t);
  }
  return `<div class="colonnes">${[...g].map(([l, ts]) => `<section><h3>${esc(l)}</h3><ul>${ts.map(t => `<li><a href="${esc(lienPage(t))}">${esc(t)}</a></li>`).join('')}</ul></section>`).join('')}</div>`;
};

const message = (main, titre, html) => { titreDoc(titre); main.innerHTML = `<h1 class="titre-page">${esc(titre)}</h1><div class="corps">${html}</div>`; };

/* ---------------------------------------------------------------- article */

export function vueArticle(main, ctx, titre) {
  const {depot} = ctx;
  const {page, redirection} = depot.trouver(titre);
  if (!page) return vuePageAbsente(main, ctx, titre);
  titreDoc(page.titre);
  const {html, sections} = rendreCorps(page.corps, depot, page.titre);
  const liees = depot.retroliens(page.titre);
  main.innerHTML = `${onglets(page.titre, 'lire')}
    <h1 class="titre-page">${esc(page.titre)}</h1>
    ${redirection ? `<div class="sous-titre">(Redirigé depuis <b>${esc(redirection)}</b>)</div>` : ''}
    ${page.erreur ? `<div class="alerte">Le bloc d’infos en tête de page est illisible : <code>${esc(page.erreur)}</code>. <a href="#/modifier/${encoderTitre(page.titre)}">Le corriger</a></div>` : ''}
    <div class="corps">
      ${rendreEncadre(page, depot)}
      ${rendreSommaire(sections)}
      ${page.corps.trim() ? html : `<p class="discret">Cette page est vide. <a href="#/modifier/${encoderTitre(page.titre)}">Écrire son contenu</a>.</p>`}
    </div>
    ${page.categories.length ? `<div class="categories"><a href="#/special/categories">Catégories</a> : ${page.categories.map(c => `<a href="#/categorie/${encoderTitre(c)}">${esc(c)}</a>`).join('<span class="sep"> · </span>')}</div>` : ''}
    ${liees.length ? `<details class="liees"><summary>Pages qui mènent ici (${liees.length})</summary><ul>${liees.map(t => `<li><a href="${esc(lienPage(t))}">${esc(t)}</a></li>`).join('')}</ul></details>` : ''}`;
  finaliser(main, depot, optionsFinaliser(depot));
  return {garderDefilement: false};
}

export function vuePageAbsente(main, ctx, titre) {
  const {depot} = ctx;
  titreDoc(titre);
  const proches = suggestions(depot, titre, 6).filter(s => s.page.titre !== titre);
  const dem = depot.demandees.get(cle(titre));
  const v = verifierTitre(titre);
  main.innerHTML = `${onglets(titre, '', false)}
    <h1 class="titre-page">${esc(titre)}</h1>
    <div class="corps">
      <p>Cette page n’existe pas encore.</p>
      ${v.erreur ? `<div class="alerte">${esc(v.erreur)}</div>` : `<p><a class="bouton principal" href="#/modifier/${encoderTitre(titre)}">Créer la page « ${esc(titre)} »</a></p>`}
      ${dem ? `<p>Pages qui ont un lien vers elle : ${[...dem.sources].sort(comparer).map(t => `<a href="${esc(lienPage(t))}">${esc(t)}</a>`).join(', ')}.</p>` : ''}
      ${proches.length ? `<h2>Pages au titre proche</h2><ul>${proches.map(s => `<li><a href="${esc(lienPage(s.page.titre))}">${esc(s.page.titre)}</a></li>`).join('')}</ul>` : ''}
      <p><a href="#/recherche/${encodeURIComponent(titre)}">Rechercher « ${esc(titre)} » dans le contenu des pages</a></p>
    </div>`;
  return {};
}

export function vueAccueil(main, ctx) {
  const {depot} = ctx;
  if (depot.page('Accueil')) return vueArticle(main, ctx, 'Accueil');
  titreDoc('');
  const cats = depot.categories().sort((a, b) => b.pages.length - a.pages.length).slice(0, 12);
  const n = depot.pages.size;
  main.innerHTML = `<h1 class="titre-page">Bienvenue sur ton wiki</h1>
    <div class="corps">
      <p>${n ? `Le wiki compte ${pluriel(n, 'page', 'pages')}, ${pluriel(depot.cats.size, 'catégorie', 'catégories')} et ${pluriel(depot.medias.size, 'fichier', 'fichiers')}.` : 'Le wiki est encore vide.'}</p>
      <p><a class="bouton principal" href="#/modifier/Accueil">Créer la page d’accueil</a> <a class="bouton" href="#/special/nouvelle">Nouvelle page</a></p>
      ${cats.length ? `<h2>Catégories</h2><ul class="nuage">${cats.map(c => `<li><a href="#/categorie/${encoderTitre(c.nom)}">${esc(c.nom)}</a> <span class="discret">(${c.pages.length})</span></li>`).join('')}</ul>` : ''}
      ${n ? `<h2>Toutes les pages</h2>${groupesParLettre(depot.toutes().map(p => p.titre))}` : `<p>Commence par la page d’accueil, ou consulte l’<a href="#/aide">aide</a> pour la syntaxe.</p>`}
    </div>`;
  return {};
}

/* ---------------------------------------------------------------- historique, versions, différences */

export function vueHistorique(main, ctx, titre) {
  const {depot} = ctx;
  const page = depot.page(titre);
  const nom = page?.titre ?? titre, chemin = page?.chemin ?? depot.cheminArticle(titre);
  titreDoc('Historique de ' + nom);
  main.innerHTML = `${onglets(nom, 'historique', !!page)}
    <h1 class="titre-page">Historique de « ${esc(nom)} »</h1>
    <div class="corps"><p class="discret chargement-texte">Chargement de l’historique…</p></div>`;
  const corps = main.querySelector('.corps');
  let vivant = true;
  depot.source.historique(chemin).then(liste => {
    if (!vivant) return;
    if (!liste.length) { corps.innerHTML = '<p>Aucune modification enregistrée pour cette page.</p>'; return; }
    for (const c of liste) cacheInfosCommits.set(c.sha, c);
    const t = encoderTitre(nom);
    corps.innerHTML = `<p class="discret">${pluriel(liste.length, 'modification', 'modifications')}, de la plus récente à la plus ancienne. L’historique d’une page renommée commence à son renommage.</p>
      <ul class="historique">${liste.map((c, i) => {
        const prec = liste[i + 1];
        return `<li>
          <span class="date"><a href="#/version/${t}/${c.sha}">${esc(dateHeure(c.date))}</a></span>
          <span class="auteur">${esc(c.auteur)}</span>
          <span class="msg">${esc(c.message.split('\n')[0])}</span>
          <span class="liens">${i === 0 && page ? '<span class="etiquette">actuelle</span>' : ''}
            ${prec ? `<a href="#/diff/${t}/${prec.sha}/${c.sha}">différences</a>` : '<span class="etiquette">création</span>'}</span>
        </li>`;
      }).join('')}</ul>`;
  }).catch(e => { if (vivant) corps.innerHTML = `<div class="alerte erreur">${esc(e.message)}</div>`; });
  return {quitter() { vivant = false; }, rafraichir() {}};
}

export function vueVersion(main, ctx, titre, sha) {
  const {depot} = ctx;
  const page = depot.page(titre);
  const nom = page?.titre ?? titre, chemin = page?.chemin ?? depot.cheminArticle(titre);
  const info = cacheInfosCommits.get(sha);
  titreDoc(nom + ' (ancienne version)');
  main.innerHTML = `${onglets(nom, 'version', !!page)}<h1 class="titre-page">${esc(nom)}</h1><div class="corps"><p class="discret">Chargement de la version…</p></div>`;
  let vivant = true;
  depot.source.version(chemin, sha).then(texte => {
    if (!vivant) return;
    if (texte === null) { main.querySelector('.corps').innerHTML = '<p>Cette page n’existait pas à cette version.</p>'; return; }
    const p = analyser(chemin, null, texte);
    p.titre = nom;
    const {html, sections} = rendreCorps(p.corps, depot, nom);
    main.innerHTML = `${onglets(nom, 'version', !!page)}
      <h1 class="titre-page">${esc(nom)}</h1>
      <div class="bandeau-version">
        <p>Ancienne version${info ? ` du <b>${esc(dateHeure(info.date))}</b>${info.auteur ? ` par ${esc(info.auteur)}` : ''} : « ${esc(info.message.split('\n')[0])} »` : ` (${esc(sha.slice(0, 7))})`}.</p>
        <p>${page ? `<a href="${esc(lienPage(nom))}">Voir la version actuelle</a> · ` : ''}<button type="button" class="lien" id="restaurer">Restaurer cette version</button></p>
      </div>
      <div class="corps">${rendreEncadre(p, depot)}${rendreSommaire(sections)}${html}</div>`;
    finaliser(main, depot, optionsFinaliser(depot));
    main.querySelector('#restaurer').addEventListener('click', () => {
      try { sessionStorage.setItem('wiki.restaurer', JSON.stringify({titre: nom, texte, date: info?.date || null})); } catch { /* rien */ }
      ctx.aller('#/modifier/' + encoderTitre(nom));
    });
  }).catch(e => { if (vivant) main.querySelector('.corps').innerHTML = `<div class="alerte erreur">${esc(e.message)}</div>`; });
  return {quitter() { vivant = false; }, rafraichir() {}};
}

export function vueDiff(main, ctx, titre, ancien, nouveau) {
  const {depot} = ctx;
  const page = depot.page(titre);
  const nom = page?.titre ?? titre, chemin = page?.chemin ?? depot.cheminArticle(titre);
  titreDoc('Différences — ' + nom);
  const ia = cacheInfosCommits.get(ancien), ib = cacheInfosCommits.get(nouveau);
  main.innerHTML = `${onglets(nom, 'historique', !!page)}
    <h1 class="titre-page">Différences — « ${esc(nom)} »</h1>
    <div class="corps"><p class="discret">Comparaison en cours…</p></div>`;
  let vivant = true;
  Promise.all([depot.source.version(chemin, ancien), depot.source.version(chemin, nouveau)]).then(([a, b]) => {
    if (!vivant) return;
    const t = encoderTitre(nom);
    main.querySelector('.corps').innerHTML = `
      <div class="entete-diff">
        <div class="retrait"><b>Avant</b> : <a href="#/version/${t}/${esc(ancien)}">${ia ? esc(dateHeure(ia.date)) : esc(ancien.slice(0, 7))}</a></div>
        <div class="ajout"><b>Après</b> : <a href="#/version/${t}/${esc(nouveau)}">${ib ? esc(dateHeure(ib.date)) : esc(nouveau.slice(0, 7))}</a>${ib ? ` — ${esc(ib.message.split('\n')[0])}` : ''}</div>
      </div>
      ${rendreDifferences(differences(a ?? '', b ?? ''))}
      <p><a href="#/historique/${t}">Retour à l’historique</a></p>`;
  }).catch(e => { if (vivant) main.querySelector('.corps').innerHTML = `<div class="alerte erreur">${esc(e.message)}</div>`; });
  return {quitter() { vivant = false; }, rafraichir() {}};
}

/* ---------------------------------------------------------------- catégories et pages spéciales */

export function vueCategorie(main, ctx, nom) {
  const {depot} = ctx;
  const c = depot.categorie(nom);
  const affiche = c?.nom ?? nom;
  titreDoc('Catégorie : ' + affiche);
  main.innerHTML = `<h1 class="titre-page"><span class="discret">Catégorie :</span> ${esc(affiche)}</h1>
    <div class="corps">${c ? `<p>${pluriel(c.pages.length, 'page', 'pages')} dans cette catégorie.</p>${groupesParLettre(c.pages)}` : '<p>Aucune page dans cette catégorie.</p>'}
    <p><a href="#/special/categories">Toutes les catégories</a></p></div>`;
  return {};
}

const SPECIALES = {
  pages: 'Toutes les pages', categories: 'Catégories', recentes: 'Modifications récentes',
  demandees: 'Pages demandées', orphelines: 'Pages orphelines', nouvelle: 'Nouvelle page',
};

export function vueSpeciale(main, ctx, nom) {
  const {depot} = ctx;
  if (nom === 'hasard') {
    const p = depot.auHasard();
    if (p) { location.replace(lienPage(p.titre)); return {}; }
    message(main, 'Page au hasard', '<p>Le wiki ne contient encore aucune page.</p>');
    return {};
  }
  if (!SPECIALES[nom]) return vueIntrouvable(main, ctx);
  titreDoc(SPECIALES[nom]);
  const debut = `<h1 class="titre-page">${esc(SPECIALES[nom])}</h1>`;
  if (nom === 'pages') {
    const l = depot.toutes();
    main.innerHTML = `${debut}<div class="corps"><p>${pluriel(l.length, 'page', 'pages')}.</p>${groupesParLettre(l.map(p => p.titre))}</div>`;
  } else if (nom === 'categories') {
    const l = depot.categories();
    main.innerHTML = `${debut}<div class="corps">${l.length ? `<ul class="colonnes-simples">${l.map(c => `<li><a href="#/categorie/${encoderTitre(c.nom)}">${esc(c.nom)}</a> <span class="discret">(${c.pages.length})</span></li>`).join('')}</ul>`
      : '<p>Aucune catégorie pour l’instant. Ajoute <code>categories: [Voyages]</code> dans le bloc d’infos d’une page (voir l’<a href="#/aide">aide</a>).</p>'}</div>`;
  } else if (nom === 'demandees') {
    const l = depot.pagesDemandees();
    main.innerHTML = `${debut}<div class="corps"><p>Les liens rouges du wiki : des pages citées qui n’existent pas encore.</p>
      ${l.length ? `<ol>${l.map(d => `<li><a class="wl nouveau" href="#/modifier/${encoderTitre(d.titre)}">${esc(d.titre)}</a> <span class="discret">— ${pluriel(d.sources.size, 'lien', 'liens')} depuis ${[...d.sources].sort(comparer).slice(0, 5).map(t => `<a href="${esc(lienPage(t))}">${esc(t)}</a>`).join(', ')}${d.sources.size > 5 ? '…' : ''}</span></li>`).join('')}</ol>` : '<p>Aucune page demandée : tous les liens mènent à une page existante.</p>'}</div>`;
  } else if (nom === 'orphelines') {
    const l = depot.orphelines();
    main.innerHTML = `${debut}<div class="corps"><p>Les pages vers lesquelles aucun lien ne mène.</p>
      ${l.length ? `<ul class="colonnes-simples">${l.map(p => `<li><a href="${esc(lienPage(p.titre))}">${esc(p.titre)}</a></li>`).join('')}</ul>` : '<p>Aucune page orpheline.</p>'}</div>`;
  } else if (nom === 'nouvelle') {
    main.innerHTML = `${debut}<div class="corps"><form class="formulaire" id="form-nouvelle">
      <label>Titre de la page <input name="titre" required maxlength="120" autocomplete="off" placeholder="ex. : Voyage au Japon"></label>
      <p class="erreur-champ" hidden></p>
      <p><button class="principal">Créer la page</button></p></form></div>`;
    const f = main.querySelector('#form-nouvelle');
    f.titre.focus();
    f.addEventListener('submit', e => {
      e.preventDefault();
      const v = verifierTitre(f.titre.value), err = f.querySelector('.erreur-champ');
      if (v.erreur) { err.textContent = v.erreur; err.hidden = false; return; }
      const p = depot.page(v.titre);
      if (p) { ctx.annoncer(`La page « ${p.titre} » existe déjà.`); ctx.aller(lienPage(p.titre)); return; }
      ctx.aller('#/modifier/' + encoderTitre(v.titre));
    });
  } else if (nom === 'recentes') {
    return vueRecentes(main, ctx, debut);
  }
  return {};
}

function vueRecentes(main, ctx, debut) {
  const {depot} = ctx;
  main.innerHTML = `${debut}<div class="corps"><p class="discret">Chargement…</p></div>`;
  let vivant = true;
  const titreDe = chemin => depot.estArticle(chemin) ? chemin.split('/').pop().replace(/\.md$/i, '') : null;
  depot.source.recentes(30).then(async liste => {
    if (!vivant) return;
    const corps = main.querySelector('.corps');
    if (!liste.length) { corps.innerHTML = '<p>Aucune modification.</p>'; return; }
    for (const c of liste) cacheInfosCommits.set(c.sha, c);
    corps.innerHTML = `<ul class="historique recentes">${liste.map(c => `<li data-sha="${c.sha}">
      <span class="date">${esc(dateHeure(c.date))}</span><span class="auteur">${esc(c.auteur)}</span>
      <span class="msg">${esc(c.message.split('\n')[0])}</span><span class="pages discret"></span></li>`).join('')}</ul>`;
    /* les pages touchées par chaque commit (6 demandes à la fois, gardées en mémoire) */
    let i = 0;
    const suivant = async () => {
      while (vivant && i < liste.length) {
        const c = liste[i++];
        try {
          if (!cacheFichiersCommits.has(c.sha)) cacheFichiersCommits.set(c.sha, await depot.source.fichiersCommit(c.sha));
        } catch { continue; }
        const li = corps.querySelector(`li[data-sha="${c.sha}"] .pages`);
        const pages = cacheFichiersCommits.get(c.sha).map(f => ({t: titreDe(f.chemin), etat: f.etat})).filter(x => x.t);
        if (li && pages.length) li.innerHTML = pages.map(x => {
          const p = depot.page(x.t);
          return p ? `<a href="${esc(lienPage(p.titre))}">${esc(p.titre)}</a>` : `<span class="supprimee">${esc(x.t)}</span>`;
        }).join(', ');
      }
    };
    await Promise.all(Array.from({length: 6}, suivant));
  }).catch(e => { if (vivant) main.querySelector('.corps').innerHTML = `<div class="alerte erreur">${esc(e.message)}</div>`; });
  return {quitter() { vivant = false; }, rafraichir() {}};
}

/* ---------------------------------------------------------------- recherche */

export function vueRecherche(main, ctx, q) {
  const {depot} = ctx;
  titreDoc('Recherche : ' + q);
  const t0 = performance.now();
  const res = rechercher(depot, q);
  const ms = Math.round(performance.now() - t0);
  const exacte = depot.page(q);
  main.innerHTML = `<h1 class="titre-page">Résultats de la recherche</h1>
    <div class="corps">
      <form class="formulaire recherche-page" id="form-recherche-page"><input name="q" type="search" value="${esc(q)}" aria-label="Rechercher"><button class="principal">Rechercher</button></form>
      ${exacte ? `<p>Il existe une page nommée « <a href="${esc(lienPage(exacte.titre))}">${esc(exacte.titre)}</a> ».</p>`
        : q.trim() && !verifierTitre(q).erreur ? `<p>Créer la page « <a class="wl nouveau" href="#/modifier/${encoderTitre(q.trim())}">${esc(q.trim())}</a> » ?</p>` : ''}
      <p class="discret">${pluriel(res.length, 'résultat', 'résultats')} (${ms} ms)</p>
      <ul class="resultats">${res.slice(0, 100).map(r => `<li>
        <a class="titre-resultat" href="${esc(lienPage(r.page.titre))}">${esc(r.page.titre)}</a>
        <div class="extrait">${extrait(r.page, r.termes)}</div>
        ${r.page.categories.length ? `<div class="discret">${r.page.categories.map(esc).join(' · ')}</div>` : ''}
      </li>`).join('')}</ul>
    </div>`;
  main.querySelector('#form-recherche-page').addEventListener('submit', e => {
    e.preventDefault();
    const v = e.target.q.value.trim();
    if (v) ctx.aller('#/recherche/' + encodeURIComponent(v));
  });
  return {};
}

/* ---------------------------------------------------------------- renommer, supprimer */

export function vueRenommer(main, ctx, titre) {
  const {depot} = ctx;
  const page = depot.page(titre);
  if (!page) return vuePageAbsente(main, ctx, titre);
  titreDoc('Renommer ' + page.titre);
  const liees = depot.retroliens(page.titre);
  main.innerHTML = `${onglets(page.titre, '')}
    <h1 class="titre-page">Renommer « ${esc(page.titre)} »</h1>
    <div class="corps"><form class="formulaire" id="form-renommer">
      <label>Nouveau titre <input name="titre" required maxlength="120" value="${esc(page.titre)}" autocomplete="off"></label>
      ${liees.length ? `<label class="case"><input type="checkbox" name="liens" checked> Corriger les liens dans ${pluriel(liees.length, 'page qui y mène', 'pages qui y mènent')}</label>` : ''}
      <p class="discret">Tout est fait en une seule modification sur GitHub.</p>
      <p class="erreur-champ" hidden></p>
      <p><button class="principal">Renommer</button> <a class="bouton" href="${esc(lienPage(page.titre))}">Annuler</a></p>
    </form></div>`;
  const f = main.querySelector('form');
  f.titre.select();
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const err = f.querySelector('.erreur-champ'), b = f.querySelector('button');
    err.hidden = true; b.disabled = true; b.textContent = 'Renommage…';
    try {
      const p = await depot.renommer(page.titre, f.titre.value, {majLiens: f.liens ? f.liens.checked : false});
      ctx.annoncer('Page renommée.', 'succes');
      ctx.aller(lienPage(p.titre));
    } catch (x) {
      err.textContent = x.message; err.hidden = false; b.disabled = false; b.textContent = 'Renommer';
    }
  });
  return {rafraichir() {}};
}

export function vueSupprimer(main, ctx, titre) {
  const {depot} = ctx;
  const page = depot.page(titre);
  if (!page) return vuePageAbsente(main, ctx, titre);
  titreDoc('Supprimer ' + page.titre);
  const liees = depot.retroliens(page.titre);
  main.innerHTML = `${onglets(page.titre, '')}
    <h1 class="titre-page">Supprimer « ${esc(page.titre)} » ?</h1>
    <div class="corps">
      <p>La page disparaîtra du wiki. Elle restera dans l’historique de GitHub : tu pourras la retrouver dans son <a href="#/historique/${encoderTitre(page.titre)}">historique</a> et la restaurer.</p>
      ${liees.length ? `<div class="alerte">${pluriel(liees.length, 'page a', 'pages ont')} un lien vers elle : ${liees.map(t => `<a href="${esc(lienPage(t))}">${esc(t)}</a>`).join(', ')}. Ces liens deviendront rouges.</div>` : ''}
      <p class="erreur-champ" hidden></p>
      <p><button class="danger" id="confirmer">Supprimer la page</button> <a class="bouton" href="${esc(lienPage(page.titre))}">Annuler</a></p>
    </div>`;
  const b = main.querySelector('#confirmer');
  b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = 'Suppression…';
    try {
      await depot.supprimer(page.titre);
      ctx.annoncer(`Page « ${page.titre} » supprimée.`, 'succes');
      ctx.aller('#/');
    } catch (x) {
      const err = main.querySelector('.erreur-champ'); err.textContent = x.message; err.hidden = false;
      b.disabled = false; b.textContent = 'Supprimer la page';
    }
  });
  return {rafraichir() {}};
}

/* ---------------------------------------------------------------- aide, bienvenue, chargement */

export function vueAide(main, ctx) {
  titreDoc('Aide');
  const {html, sections} = rendreCorps(AIDE, ctx.depot, 'Aide');
  main.innerHTML = `<h1 class="titre-page">Aide</h1><div class="corps">${rendreSommaire(sections)}${html}</div>`;
  return {};
}

export function vueBienvenue(main, ctx) {
  titreDoc('');
  main.innerHTML = `<h1 class="titre-page">Bienvenue</h1>
    <div class="corps">
      <p>Ce wiki affiche le contenu de ton <b>dépôt GitHub privé</b> : une page par fichier Markdown, des liens entre les pages, des photos, des catégories et l’historique de chaque modification.</p>
      <p>Tes textes ne sont jamais dans ce site : l’appli les lit directement dans ton dépôt privé avec ta clé, et les garde sur cet appareil pour s’ouvrir vite, même hors ligne.</p>
      <p><a class="bouton principal" href="#/reglages">Connecter mon dépôt</a> <button type="button" class="bouton" id="essayer-demo">Essayer avec des pages d’exemple</button></p>
    </div>`;
  main.querySelector('#essayer-demo').addEventListener('click', () => {
    enregistrerReglages({...reglages(), mode: 'demo'});
    location.hash = '#/';
    ctx.demarrerDepot();
  });
  return {};
}

export function vueChargement(main, ctx) {
  titreDoc('');
  const d = ctx.depot;
  const dessiner = () => {
    const s = d.statut;
    main.innerHTML = `<h1 class="titre-page">Ouverture du wiki</h1><div class="corps">
      ${s.etat === 'erreur' || s.etat === 'hors-ligne' ? `<div class="alerte erreur">${esc(s.message || 'Connexion impossible.')}</div>
        <p><button type="button" class="principal" id="reessayer">Réessayer</button> <a class="bouton" href="#/reglages">Réglages</a></p>`
        : `<p class="chargement-texte">${esc(s.message || 'Connexion à GitHub…')}</p><p class="discret">Le premier chargement télécharge tout le wiki ; les suivants seront immédiats.</p>`}
    </div>`;
    main.querySelector('#reessayer')?.addEventListener('click', () => ctx.demarrerDepot());
  };
  dessiner();
  const fin = d.surChangement(type => { if (type === 'statut') dessiner(); });
  return {quitter: fin, rafraichir() {}};
}

export function vueIntrouvable(main) {
  message(main, 'Page introuvable', '<p>Cette adresse ne correspond à aucune page du wiki. <a href="#/">Retour à l’accueil</a></p>');
  return {};
}

/* ---------------------------------------------------------------- réglages */

export function vueReglages(main, ctx) {
  titreDoc('Réglages');
  const r = reglages();
  const d = ctx.depot;
  main.innerHTML = `<h1 class="titre-page">Réglages</h1>
  <div class="corps">
    <form class="formulaire" id="form-depot" autocomplete="off">
      <h2>Dépôt GitHub</h2>
      <div class="ligne-champs">
        <label>Propriétaire <input name="proprietaire" required value="${esc(r.proprietaire)}" spellcheck="false" autocapitalize="off"></label>
        <label>Dépôt privé <input name="depot" required value="${esc(r.depot)}" spellcheck="false" autocapitalize="off"></label>
        <label>Branche <input name="branche" required value="${esc(r.branche)}" spellcheck="false" autocapitalize="off"></label>
      </div>
      <label>Clé GitHub
        <span class="champ-cle"><input name="jeton" type="password" value="${esc(r.jeton)}" placeholder="github_pat_…" spellcheck="false" autocapitalize="off"><button type="button" class="lien" id="voir-cle">Afficher</button></span>
      </label>
      <details class="guide"><summary>Comment créer la clé</summary>
        <ol>
          <li>Ouvre <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">github.com/settings/personal-access-tokens/new</a> (connecté à ton compte).</li>
          <li><b>Token name</b> : « Wiki » ; <b>Expiration</b> : la durée de ton choix (à la fin, il faudra en recréer une).</li>
          <li><b>Repository access</b> : <i>Only select repositories</i>, puis choisis <b>${esc(r.depot || 'wiki-donnees')}</b> seulement.</li>
          <li><b>Permissions</b> → <b>Repository permissions</b> → <b>Contents</b> : <i>Read and write</i>.</li>
          <li><b>Generate token</b>, copie la clé (elle commence par <code>github_pat_</code>) et colle-la ci-dessus.</li>
        </ol>
        <p class="discret">La clé reste dans ce navigateur. Elle n’est envoyée qu’à GitHub (api.github.com).</p>
      </details>
      <details class="guide"><summary>Dossiers (avancé)</summary>
        <div class="ligne-champs">
          <label>Dossier des articles <input name="dossierArticles" value="${esc(r.dossierArticles)}" spellcheck="false" autocapitalize="off"></label>
          <label>Dossier des photos <input name="dossierMedias" value="${esc(r.dossierMedias)}" spellcheck="false" autocapitalize="off"></label>
        </div>
        <p class="discret">Laisse « Dossier des articles » vide si tes fichiers sont à la racine du dépôt (coffre Obsidian).</p>
      </details>
      <p class="resultat-test" hidden></p>
      <p><button class="principal" id="connecter">Enregistrer et se connecter</button></p>
    </form>

    <h2>Démo</h2>
    <p>${r.mode === 'demo' ? 'La démo est active : les pages d’exemple sont gardées sur cet appareil.' : 'Essaie le wiki avec des pages d’exemple, sans clé ni dépôt.'}</p>
    <p>${r.mode === 'demo' ? '<button type="button" class="bouton" id="demo-reinit">Remettre les pages d’exemple</button> ' : '<button type="button" class="bouton" id="demo">Essayer la démo</button>'}</p>

    <h2>Apparence</h2>
    <div class="segments" role="radiogroup" aria-label="Thème">
      ${[['auto', 'Automatique'], ['clair', 'Clair'], ['sombre', 'Sombre']].map(([v, t]) => `<label><input type="radio" name="theme" value="${v}"${r.theme === v ? ' checked' : ''}> ${t}</label>`).join('')}
    </div>

    <h2>Cet appareil</h2>
    <p class="discret">${d ? `Connecté à <b>${esc(d.source.nom)}</b>${d.etat ? ` — ${pluriel(d.pages.size, 'page', 'pages')}, ${pluriel(d.medias.size, 'fichier', 'fichiers')}` : ''}.` : 'Aucun dépôt connecté.'}</p>
    <p><button type="button" class="bouton" id="vider">Vider la copie locale</button> <button type="button" class="bouton danger" id="oublier">Oublier la clé</button></p>
    <p class="discret">Version de l’appli : ${esc(VERSION)}</p>
  </div>`;

  const f = main.querySelector('#form-depot');
  main.querySelector('#voir-cle').addEventListener('click', e => {
    const c = f.jeton; c.type = c.type === 'password' ? 'text' : 'password';
    e.target.textContent = c.type === 'password' ? 'Afficher' : 'Masquer';
  });
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const res = f.querySelector('.resultat-test'), b = f.querySelector('#connecter');
    const nv = {...reglages(), mode: 'github'};
    for (const k of ['proprietaire', 'depot', 'branche', 'jeton', 'dossierArticles', 'dossierMedias']) nv[k] = f[k].value.trim();
    if (!nv.jeton) { res.hidden = false; res.className = 'resultat-test erreur'; res.textContent = 'Colle ta clé GitHub.'; return; }
    b.disabled = true; res.hidden = false; res.className = 'resultat-test'; res.textContent = 'Vérification de la connexion…';
    try {
      const {SourceGitHub} = await import('./github.js');
      const t = await new SourceGitHub(nv).tete();
      enregistrerReglages(nv);
      res.className = 'resultat-test succes'; res.textContent = `Connexion réussie (dernier commit ${t.commit.slice(0, 7)}).`;
      await attendre(400);
      location.hash = '#/';
      ctx.demarrerDepot();
    } catch (x) {
      res.className = 'resultat-test erreur'; res.textContent = x.message;
    } finally { b.disabled = false; }
  });
  main.querySelector('#demo')?.addEventListener('click', () => { enregistrerReglages({...reglages(), mode: 'demo'}); location.hash = '#/'; ctx.demarrerDepot(); });
  main.querySelector('#demo-reinit')?.addEventListener('click', async () => {
    if (!confirm('Remettre les pages d’exemple ? Tes essais dans la démo seront effacés.')) return;
    await d?.source.reinitialiser?.();
    location.hash = '#/'; ctx.demarrerDepot();
  });
  for (const radio of main.querySelectorAll('input[name="theme"]')) radio.addEventListener('change', () => {
    const nv = {...reglages(), theme: radio.value}; enregistrerReglages(nv); appliquerTheme(nv.theme);
  });
  main.querySelector('#vider').addEventListener('click', async () => {
    if (!confirm('Vider la copie du wiki gardée sur cet appareil ? Elle sera retéléchargée depuis GitHub.')) return;
    await toutVider();
    ctx.annoncer('Copie locale vidée.');
    ctx.demarrerDepot();
  });
  main.querySelector('#oublier').addEventListener('click', async () => {
    if (!confirm('Oublier la clé GitHub et vider la copie locale du wiki sur cet appareil ?')) return;
    enregistrerReglages({...reglages(), jeton: '', mode: null});
    for (const k of local.cles('wiki.brouillon.')) local.effacer(k);
    await toutVider();
    ctx.annoncer('Clé oubliée.');
    location.hash = '#/'; ctx.demarrerDepot();
  });
  return {rafraichir() {}};
}

