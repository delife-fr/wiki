/* WIKI — éditeur d'une page.
   · Le texte complet du fichier (bloc d'infos compris) dans une zone de texte, avec aperçu.
   · Brouillon gardé sur l'appareil à chaque frappe : rien n'est perdu si l'appli se ferme.
   · Photos réduites puis envoyées avec la page, dans le même commit.
   · Si la page a changé ailleurs entre-temps, rien n'est écrasé : l'appli le signale. */

import {rendreCorps, rendreEncadre, rendreSommaire, finaliser} from './rendu.js';
import {analyser} from './analyse.js';
import {urlMedia, preparerFichier} from './medias.js';
import {suggestions} from './recherche.js';
import {onglets} from './vues.js';
import {esc, lienPage, cle, local, delai, dateHeure, verifierTitre, pluriel} from './outils.js';

const MODELE = titre => titre.toLocaleLowerCase('fr') === 'accueil'
  ? `Bienvenue sur mon wiki.\n\n## Par où commencer\n- [[Première page]]\n`
  : `---\ncategories: []\n---\n**${titre}** `;

export function vueModifier(main, ctx, titreDemande) {
  const {depot} = ctx;
  const v = verifierTitre(titreDemande);
  if (v.erreur) {
    main.innerHTML = `<h1 class="titre-page">Titre impossible</h1><div class="corps"><div class="alerte">${esc(v.erreur)}</div><p><a href="#/special/nouvelle">Choisir un autre titre</a></p></div>`;
    return {};
  }
  const page = depot.page(v.titre);
  const titre = page?.titre ?? v.titre, nouveau = !page;
  const cleBrouillon = 'wiki.brouillon.' + cle(titre);
  document.title = `${nouveau ? 'Création' : 'Modification'} de ${titre} — Wiki`;

  /* texte de départ : version à restaurer > brouillon > page actuelle > modèle */
  let restaurer = null;
  try { restaurer = JSON.parse(sessionStorage.getItem('wiki.restaurer') || 'null'); sessionStorage.removeItem('wiki.restaurer'); } catch { /* rien */ }
  if (restaurer && cle(restaurer.titre) !== cle(titre)) restaurer = null;
  const brouillon = restaurer ? null : local.lire(cleBrouillon);
  const original = page?.texte ?? '';
  let shaDepart = page?.sha ?? null;
  if (brouillon && brouillon.shaDepart !== undefined && page) shaDepart = brouillon.shaDepart ?? page.sha;
  const depart = restaurer?.texte ?? brouillon?.texte ?? (page ? page.texte : MODELE(titre));
  const attente = new Map();   /* nom en minuscules → {nom, octets, type, url} */
  let sortie = false;          /* vrai après publication ou abandon : pas de brouillon à garder */

  const alertes = [];
  if (restaurer) alertes.push(`<div class="alerte info">Version${restaurer.date ? ` du ${esc(dateHeure(restaurer.date))}` : ''} chargée : publie pour la restaurer.</div>`);
  if (brouillon && brouillon.texte !== original) {
    const change = page && brouillon.shaDepart && brouillon.shaDepart !== page.sha;
    alertes.push(`<div class="alerte info">Brouillon non publié du ${esc(dateHeure(brouillon.date))} repris. <button type="button" class="lien" id="jeter-brouillon">Revenir à la version en ligne</button>${change ? '<br><b>La page a été modifiée en ligne depuis ce brouillon</b> : à la publication, l’appli te le signalera.' : ''}</div>`);
  }

  main.innerHTML = `${onglets(titre, 'modifier', !nouveau)}
    <h1 class="titre-page">${nouveau ? 'Création' : 'Modification'} de « ${esc(titre)} »</h1>
    <div class="alertes">${alertes.join('')}</div>
    <div class="editeur">
      <div class="barre-outils" role="toolbar" aria-label="Mise en forme">
        <button type="button" data-outil="gras" title="Gras"><b>G</b></button>
        <button type="button" data-outil="italique" title="Italique"><i>I</i></button>
        <button type="button" data-outil="titre" title="Titre de section">Titre</button>
        <button type="button" data-outil="lien" title="Lien vers une page">[[ ]]</button>
        <button type="button" data-outil="liste" title="Liste à puces">• Liste</button>
        <button type="button" data-outil="note" title="Note de bas de page">Note</button>
        <button type="button" data-outil="photo" title="Ajouter une photo ou un fichier">Photo</button>
        <span class="espace"></span>
        <span class="bascule" role="tablist">
          <button type="button" role="tab" data-mode="ecrire" class="actif" aria-selected="true">Écrire</button>
          <button type="button" role="tab" data-mode="apercu" aria-selected="false">Aperçu</button>
        </span>
      </div>
      <div class="zone-texte">
        <textarea id="texte" spellcheck="true" lang="fr" aria-label="Texte de la page" autocapitalize="sentences"></textarea>
        <ul class="suggestions-liens" role="listbox" hidden></ul>
      </div>
      <div class="apercu corps" hidden></div>
      <input type="file" id="fichiers" accept="image/*,application/pdf" multiple hidden>
      <div class="photos-attente"></div>
      <label class="resume">Résumé de la modification <span class="discret">(facultatif)</span>
        <input id="resume" maxlength="200" placeholder="${nouveau ? 'ex. : première version' : 'ex. : ajout des photos'}" autocomplete="off"></label>
      <div class="actions">
        <button type="button" class="principal" id="publier">Publier</button>
        <button type="button" class="bouton" id="annuler">Annuler</button>
        <span class="etat-envoi" role="status"></span>
      </div>
      <p class="discret aide-syntaxe">Liens : <code>[[Titre]]</code> · Photos : bouton Photo · Notes : bouton Note · <a href="#/aide" target="_blank">Aide sur la syntaxe</a></p>
    </div>`;

  const zone = main.querySelector('#texte'), sugg = main.querySelector('.suggestions-liens');
  const apercu = main.querySelector('.apercu'), etat = main.querySelector('.etat-envoi');
  const boutonPublier = main.querySelector('#publier'), fichiers = main.querySelector('#fichiers');
  zone.value = depart;
  const ajuster = () => { zone.style.height = 'auto'; zone.style.height = Math.max(320, zone.scrollHeight + 4) + 'px'; };
  requestAnimationFrame(ajuster);
  if (!page) { zone.focus(); zone.setSelectionRange(zone.value.length, zone.value.length); }

  /* ---- brouillon */
  const sauverBrouillon = delai(() => {
    if (zone.value === original && !attente.size) local.effacer(cleBrouillon);
    else local.ecrire(cleBrouillon, {texte: zone.value, shaDepart, date: Date.now()});
  }, 400);
  main.querySelector('#jeter-brouillon')?.addEventListener('click', e => {
    local.effacer(cleBrouillon);
    zone.value = page ? page.texte : MODELE(titre);
    shaDepart = page?.sha ?? null;
    e.target.closest('.alerte').remove();
    ajuster();
  });

  /* ---- outils */
  const remplacer = (debut, fin, texte, selDebut, selFin) => {
    zone.focus();
    zone.setRangeText(texte, debut, fin, 'end');
    if (selDebut !== undefined) zone.setSelectionRange(selDebut, selFin ?? selDebut);
    zone.dispatchEvent(new Event('input'));
  };
  const entourer = (avant, apres, defaut) => {
    const {selectionStart: a, selectionEnd: b} = zone;
    const sel = zone.value.slice(a, b) || defaut;
    remplacer(a, b, avant + sel + apres, a + avant.length, a + avant.length + sel.length);
  };
  const debutLigne = i => zone.value.lastIndexOf('\n', i - 1) + 1;
  const outils = {
    gras: () => entourer('**', '**', 'texte en gras'),
    italique: () => entourer('*', '*', 'texte en italique'),
    lien: () => { entourer('[[', ']]', ''); montrerSuggestions(); },
    titre: () => {
      const d = debutLigne(zone.selectionStart), ligne = zone.value.slice(d).split('\n')[0];
      const nv = /^#{2,4} /.test(ligne) ? ligne.replace(/^(#{2,4}) /, (m, h) => h.length >= 4 ? '' : h + '# ') : '## ' + ligne;
      remplacer(d, d + ligne.length, nv, d + nv.length);
    },
    liste: () => {
      const d = debutLigne(zone.selectionStart), f = zone.value.indexOf('\n', zone.selectionEnd);
      const fin = f < 0 ? zone.value.length : f;
      const bloc = zone.value.slice(d, fin).split('\n').map(l => /^\s*[-*] /.test(l) ? l.replace(/^(\s*)[-*] /, '$1') : '- ' + l).join('\n');
      remplacer(d, fin, bloc, d + bloc.length);
    },
    note: () => {
      const pris = new Set([...zone.value.matchAll(/\[\^(\d+)\]/g)].map(m => +m[1]));
      let n = 1; while (pris.has(n)) n++;
      const pos = zone.selectionEnd;
      const avant = zone.value.slice(0, pos), apres = zone.value.slice(pos);
      const finTexte = apres.replace(/\s+$/, '');
      const def = `\n\n[^${n}]: `;
      zone.value = avant + `[^${n}]` + finTexte + def;
      const curseur = zone.value.length;
      zone.focus(); zone.setSelectionRange(curseur, curseur);
      zone.dispatchEvent(new Event('input'));
      ctx.annoncer('Écris le texte de la note en bas de la page.');
    },
    photo: () => fichiers.click(),
  };
  main.querySelector('.barre-outils').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.outil) { e.preventDefault(); outils[b.dataset.outil](); }
    if (b.dataset.mode) basculer(b.dataset.mode);
  });

  /* ---- aperçu */
  function basculer(mode) {
    for (const b of main.querySelectorAll('.bascule button')) { const a = b.dataset.mode === mode; b.classList.toggle('actif', a); b.setAttribute('aria-selected', a); }
    const ap = mode === 'apercu';
    main.querySelector('.zone-texte').hidden = ap; apercu.hidden = !ap;
    for (const b of main.querySelectorAll('[data-outil]')) b.disabled = ap;
    if (ap) {
      const p = analyser(page?.chemin ?? depot.cheminArticle(titre), null, zone.value);
      p.titre = titre;
      const {html, sections} = rendreCorps(p.corps, depot, titre);
      apercu.innerHTML = (p.erreur ? `<div class="alerte">Bloc d’infos illisible : <code>${esc(p.erreur)}</code></div>` : '')
        + rendreEncadre(p, depot) + rendreSommaire(sections) + (html || '<p class="discret">(page vide)</p>')
        + (p.categories.length ? `<div class="categories"><span class="etiq">Catégories</span>${p.categories.map(c => `<span class="puce">${esc(c)}</span>`).join('')}</div>` : '');
      finaliser(apercu, depot, {urlMedia: e => urlMedia(depot, e), attente});
    } else zone.focus();
  }

  /* ---- propositions de titres après [[ */
  let choix = 0, propositions = [], debutRequete = -1;
  function montrerSuggestions() {
    const pos = zone.selectionStart, avant = zone.value.slice(Math.max(0, pos - 120), pos);
    const m = /(!?)\[\[([^[\]\n|#]*)$/.exec(avant);
    if (!m || m[1] || zone.selectionStart !== zone.selectionEnd) { cacher(); return; }
    debutRequete = pos - m[2].length;
    const q = m[2];
    propositions = q.trim() ? suggestions(depot, q, 6).map(s => s.page.titre) : [];
    if (!propositions.length) { cacher(); return; }
    choix = 0;
    sugg.innerHTML = propositions.map((t, i) => `<li role="option" data-i="${i}"${i === 0 ? ' class="choisi"' : ''}>${esc(t)}</li>`).join('');
    sugg.hidden = false;
  }
  function cacher() { sugg.hidden = true; propositions = []; }
  const inserer = t => {
    const pos = zone.selectionStart, suite = zone.value.slice(pos);
    const ferme = suite.startsWith(']]') ? 2 : 0;
    remplacer(debutRequete, pos + ferme, t + ']]', debutRequete + t.length + 2);
    cacher();
  };
  sugg.addEventListener('pointerdown', e => { const li = e.target.closest('li'); if (li) { e.preventDefault(); inserer(propositions[+li.dataset.i]); } });
  zone.addEventListener('keydown', e => {
    if (sugg.hidden || !propositions.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      choix = (choix + (e.key === 'ArrowDown' ? 1 : propositions.length - 1)) % propositions.length;
      sugg.querySelectorAll('li').forEach((li, i) => li.classList.toggle('choisi', i === choix));
    } else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); inserer(propositions[choix]); }
    else if (e.key === 'Escape') { e.preventDefault(); cacher(); }
  });
  zone.addEventListener('input', () => { ajuster(); sauverBrouillon(); montrerSuggestions(); });
  zone.addEventListener('click', montrerSuggestions);
  zone.addEventListener('blur', () => setTimeout(cacher, 150));

  /* ---- photos */
  const dessinerAttente = () => {
    const div = main.querySelector('.photos-attente');
    div.innerHTML = attente.size ? `<p class="discret">${pluriel(attente.size, 'fichier envoyé', 'fichiers envoyés')} avec la page :</p><ul>${[...attente.values()].map(m =>
      `<li>${m.type.startsWith('image/') ? `<img src="${esc(m.url)}" alt="">` : '<span class="icone-fichier">📄</span>'}<span>${esc(m.nom)} <span class="discret">(${Math.round(m.octets.length / 1024)} Ko)</span></span><button type="button" class="lien" data-retirer="${esc(m.nom)}">Retirer</button></li>`).join('')}</ul>` : '';
  };
  main.querySelector('.photos-attente').addEventListener('click', e => {
    const n = e.target.dataset?.retirer;
    if (!n) return;
    const m = attente.get(n.toLowerCase());
    attente.delete(n.toLowerCase());
    if (m) URL.revokeObjectURL(m.url);
    const re = new RegExp(`\\n?!\\[\\[${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\|[^\\]]*)?\\]\\]\\n?`, 'g');
    zone.value = zone.value.replace(re, '\n');
    zone.dispatchEvent(new Event('input'));
    dessinerAttente();
  });
  fichiers.addEventListener('change', async () => {
    const liste = [...fichiers.files];
    fichiers.value = '';
    for (const f of liste) {
      etat.textContent = `Préparation de ${f.name}…`;
      try {
        const m = await preparerFichier(f);
        m.nom = depot.nomMediaLibre(m.nom, new Set(attente.keys()));
        attente.set(m.nom.toLowerCase(), m);
        const pos = zone.selectionEnd, avant = zone.value.slice(0, pos);
        const insert = (avant && !avant.endsWith('\n') ? '\n' : '') + `![[${m.nom}]]\n`;
        remplacer(pos, pos, insert, pos + insert.length);
      } catch (e) { ctx.annoncer(e.message, 'erreur', 6000); }
    }
    etat.textContent = '';
    dessinerAttente();
  });

  /* ---- publier / annuler */
  const montrerConflit = (texteDistant) => {
    const a = main.querySelector('.alertes');
    a.innerHTML = `<div class="alerte erreur"><b>Cette page a été modifiée ailleurs pendant que tu l’écrivais.</b> Ton texte est gardé ci-dessous (et en brouillon).
      <details><summary>Voir la version en ligne</summary><pre class="texte-distant">${esc(texteDistant ?? '')}</pre></details>
      <p><button type="button" class="bouton" id="ecraser">Publier quand même mon texte (remplace la version en ligne)</button>
      <button type="button" class="bouton" id="prendre-distant">Repartir de la version en ligne</button></p></div>`;
    a.querySelector('#ecraser').addEventListener('click', () => { shaDepart = depot.page(titre)?.sha ?? null; a.innerHTML = ''; publier(); });
    a.querySelector('#prendre-distant').addEventListener('click', () => {
      zone.value = texteDistant ?? ''; shaDepart = depot.page(titre)?.sha ?? null; a.innerHTML = ''; zone.dispatchEvent(new Event('input'));
    });
    a.scrollIntoView({behavior: 'smooth', block: 'center'});
  };

  async function publier() {
    sauverBrouillonImmediat();   /* si l'envoi échoue (réseau), le texte est déjà à l'abri */
    boutonPublier.disabled = true; etat.textContent = 'Envoi à GitHub…';
    try {
      const p = await depot.publier({titre, texte: zone.value, resume: main.querySelector('#resume').value, shaDepart, medias: [...attente.values()]});
      local.effacer(cleBrouillon);
      for (const m of attente.values()) URL.revokeObjectURL(m.url);
      attente.clear();
      sortie = true;
      ctx.annoncer(nouveau ? 'Page créée.' : 'Modifications publiées.', 'succes');
      ctx.aller(lienPage(p?.titre ?? titre));
    } catch (e) {
      etat.textContent = '';
      if (e.code === 'conflit' && e.texteDistant !== undefined) montrerConflit(e.texteDistant);
      else if (e.code === 'existe') {
        etat.innerHTML = `<span class="erreur">${esc(e.message)}</span>`;
        shaDepart = e.page?.sha ?? null;
        montrerConflit(e.page?.texte);
      } else etat.innerHTML = `<span class="erreur">${esc(e.message)}${e.code === 'reseau' ? ' Ton texte est gardé en brouillon sur cet appareil.' : ''}</span>`;
    } finally { boutonPublier.disabled = false; }
  }
  boutonPublier.addEventListener('click', publier);
  zone.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); publier(); } });

  /* l'appli passe en arrière-plan ou se ferme (téléphone) : brouillon enregistré sans attendre */
  const aLArriere = () => { if (!sortie && document.visibilityState === 'hidden') sauverBrouillonImmediat(); };
  const aLaFermeture = () => { if (!sortie) sauverBrouillonImmediat(); };
  document.addEventListener('visibilitychange', aLArriere);
  window.addEventListener('pagehide', aLaFermeture);

  main.querySelector('#annuler').addEventListener('click', () => {
    if ((zone.value !== (page ? page.texte : MODELE(titre)) || attente.size) && !confirm('Abandonner tes modifications ?')) return;
    local.effacer(cleBrouillon);
    sortie = true;
    ctx.aller(page ? lienPage(page.titre) : '#/');
  });

  return {
    garderDefilement: false,
    rafraichir() {
      /* le wiki a changé pendant l'édition : on ne touche pas au texte, on prévient seulement */
      const p = depot.page(titre);
      if (p && shaDepart && p.sha !== shaDepart && !main.querySelector('.alerte.distante')) {
        main.querySelector('.alertes').insertAdjacentHTML('beforeend', '<div class="alerte distante">Cette page vient d’être modifiée ailleurs. Tu pourras comparer avant de publier.</div>');
      }
    },
    quitter() {
      document.removeEventListener('visibilitychange', aLArriere);
      window.removeEventListener('pagehide', aLaFermeture);
      if (!sortie) sauverBrouillonImmediat();
      for (const m of attente.values()) URL.revokeObjectURL(m.url);
    },
  };

  function sauverBrouillonImmediat() {
    if (zone.value === original && !attente.size) local.effacer(cleBrouillon);
    else local.ecrire(cleBrouillon, {texte: zone.value, shaDepart, date: Date.now()});
  }
}

