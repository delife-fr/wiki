/* WIKI — le contenu du wiki tel que l'appli le connaît : pages, liens, catégories, photos.
   · Au démarrage : tout vient du cache de l'appareil (affichage immédiat, même hors ligne).
   · Synchronisation : une petite demande vérifie le dernier commit ; s'il a changé, la liste des fichiers
     est relue et seuls les articles modifiés sont téléchargés.
   · Écriture : un commit par action (page + photos, ou renommage + liens corrigés), refusé par GitHub si le
     dépôt a bougé entre-temps ; dans ce cas l'appli se remet à jour et réessaie si la page n'a pas changé. */

import {analyser} from './analyse.js';
import {cle, comparer, empreinteGit, nomDepuisChemin, texteVersOctets, verifierTitre} from './outils.js';
import {lire, ecrire, ecrireTout, lireTout, garderSeulement} from './stockage.js';
import {ErreurGitHub} from './github.js';

export class ErreurWiki extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

const echapperRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class Depot {
  constructor(source, {dossierArticles = 'articles', dossierMedias = 'medias', cleCache}) {
    this.source = source;
    this.dossierArticles = dossierArticles.replace(/^\/+|\/+$/g, '');
    this.dossierMedias = dossierMedias.replace(/^\/+|\/+$/g, '');
    this.cleCache = cleCache;
    this.etat = null;               /* {tete, arbre, fichiers:[{chemin, sha, taille}]} */
    this.textes = new Map();        /* empreinte → texte */
    this.pages = new Map();         /* clé du titre → page */
    this.medias = new Map();        /* nom de fichier en minuscules → {chemin, sha, taille} */
    this.alias = new Map();         /* clé d'un alias → titre */
    this.retro = new Map();         /* clé d'un titre → Set des titres qui y mènent */
    this.demandees = new Map();     /* clé d'un titre absent → {titre, sources:Set} */
    this.cats = new Map();          /* clé d'une catégorie → {nom, pages:[titres]} */
    this.version = 0;
    this.statut = {etat: 'attente', message: ''};
    this.ecouteurs = new Set();
    this.syncEnCours = null;
    this.derniereSync = 0;
  }

  surChangement(fn) { this.ecouteurs.add(fn); return () => this.ecouteurs.delete(fn); }
  emettre(type) { for (const fn of this.ecouteurs) try { fn(type, this); } catch (e) { console.error(e); } }
  changerStatut(etat, message = '') { this.statut = {etat, message, date: Date.now()}; this.emettre('statut'); }

  estArticle(chemin) {
    if (!/\.md$/i.test(chemin) || chemin.split('/').some(s => s.startsWith('.'))) return false;
    if (this.dossierArticles) return chemin.startsWith(this.dossierArticles + '/');
    return chemin.includes('/') || !/^readme\.md$/i.test(chemin);
  }
  estMedia(chemin) { return !/\.md$/i.test(chemin) && !chemin.split('/').some(s => s.startsWith('.')); }

  /* ---------------------------------------------------------------- lecture */

  async demarrer() {
    const e = await lire('etat', this.cleCache).catch(() => null);
    if (!e?.fichiers) return false;
    const shas = e.fichiers.filter(f => this.estArticle(f.chemin)).map(f => f.sha);
    const textes = this.source.local ? await this.source.textes(shas) : await lireTout('textes', shas).catch(() => new Map());
    if (textes.size < new Set(shas).size) return false;   /* cache incomplet : on attend la synchronisation */
    this.textes = textes;
    this.etat = e;
    this.construire();
    return true;
  }

  async synchroniser({force = false} = {}) {
    if (this.syncEnCours) return this.syncEnCours;
    this.syncEnCours = (async () => {
      this.changerStatut('sync');
      try {
        const t = await this.source.tete();
        if (!force && this.etat && t.commit === this.etat.tete) {
          this.derniereSync = Date.now();
          this.changerStatut('ok');
          return false;
        }
        const fichiers = await this.source.arbre(t.arbre);
        await this.chargerTextes(fichiers);
        this.etat = {tete: t.commit, arbre: t.arbre, fichiers};
        await this.sauver();
        this.construire();
        this.derniereSync = Date.now();
        this.changerStatut('ok');
        this.emettre('change');
        return true;
      } catch (e) {
        this.changerStatut(e.code === 'reseau' ? 'hors-ligne' : 'erreur', e.message);
        throw e;
      } finally { this.syncEnCours = null; }
    })();
    return this.syncEnCours;
  }

  async chargerTextes(fichiers) {
    const voulus = [...new Set(fichiers.filter(f => this.estArticle(f.chemin)).map(f => f.sha))];
    const textes = new Map();
    for (const s of voulus) if (this.textes.has(s)) textes.set(s, this.textes.get(s));
    let manquants = voulus.filter(s => !textes.has(s));
    if (manquants.length && !this.source.local) {
      const enCache = await lireTout('textes', manquants).catch(() => new Map());
      for (const [s, t] of enCache) textes.set(s, t);
      manquants = manquants.filter(s => !textes.has(s));
    }
    if (manquants.length) {
      const nouveaux = await this.source.textes(manquants, (n, total) => this.changerStatut('sync', `Téléchargement des articles : ${n} sur ${total}`));
      for (const [s, t] of nouveaux) textes.set(s, t);
      if (!this.source.local) await ecrireTout('textes', [...nouveaux]).catch(() => {});
    }
    this.textes = textes;
  }

  async sauver() {
    await ecrire('etat', this.cleCache, this.etat).catch(() => {});
    if (!this.source.local) garderSeulement('textes', new Set(this.textes.keys())).catch(() => {});
  }

  construire() {
    const pages = new Map(), medias = new Map(), alias = new Map(), retro = new Map(), demandees = new Map(), cats = new Map();
    const fichiers = [...this.etat.fichiers].sort((a, b) => a.chemin.length - b.chemin.length || (a.chemin < b.chemin ? -1 : 1));
    for (const f of fichiers) {
      if (this.estArticle(f.chemin)) {
        const p = analyser(f.chemin, f.sha, this.textes.get(f.sha) ?? '');
        p.cle = cle(p.titre);
        if (!pages.has(p.cle)) pages.set(p.cle, p);
      } else if (this.estMedia(f.chemin)) {
        const n = nomDepuisChemin(f.chemin).toLowerCase();
        if (!medias.has(n)) medias.set(n, f);
      }
    }
    for (const p of pages.values()) for (const a of p.alias) {
      const k = cle(a);
      if (!pages.has(k) && !alias.has(k)) alias.set(k, p.titre);
    }
    const resoudre = t => { const k = cle(t); return pages.get(k) || (alias.has(k) ? pages.get(cle(alias.get(k))) : null); };
    for (const p of pages.values()) {
      for (const cible of new Set(p.liens)) {
        const dest = resoudre(cible);
        if (dest) {
          if (dest === p) continue;
          if (!retro.has(dest.cle)) retro.set(dest.cle, new Set());
          retro.get(dest.cle).add(p.titre);
        } else {
          const k = cle(cible);
          if (!demandees.has(k)) demandees.set(k, {titre: cible, sources: new Set()});
          demandees.get(k).sources.add(p.titre);
        }
      }
      for (const c of p.categories) {
        const k = cle(c);
        if (!cats.has(k)) cats.set(k, {nom: c, pages: []});
        cats.get(k).pages.push(p.titre);
      }
    }
    Object.assign(this, {pages, medias, alias, retro, demandees, cats});
    this.version++;
  }

  /* Page d'un titre (ou d'un alias) : {page, redirection} — redirection = le titre demandé s'il s'agit d'un alias. */
  trouver(titre) {
    const k = cle(titre);
    if (this.pages.has(k)) return {page: this.pages.get(k), redirection: null};
    if (this.alias.has(k)) return {page: this.pages.get(cle(this.alias.get(k))), redirection: titre};
    return {page: null, redirection: null};
  }
  page(titre) { return this.trouver(titre).page; }
  media(nom) { return this.medias.get(String(nom).trim().toLowerCase()) || null; }

  toutes() { return [...this.pages.values()].sort((a, b) => comparer(a.titre, b.titre)); }
  categories() { return [...this.cats.values()].sort((a, b) => comparer(a.nom, b.nom)); }
  categorie(nom) { return this.cats.get(cle(nom)) || null; }
  retroliens(titre) { return [...(this.retro.get(cle(titre)) || [])].sort(comparer); }
  pagesDemandees() { return [...this.demandees.values()].sort((a, b) => b.sources.size - a.sources.size || comparer(a.titre, b.titre)); }
  orphelines() { return this.toutes().filter(p => !this.retro.has(p.cle) && p.cle !== 'accueil'); }
  auHasard() { const l = [...this.pages.values()].filter(p => p.cle !== 'accueil'); return l.length ? l[Math.floor(Math.random() * l.length)] : null; }

  cheminArticle(titre) { return (this.dossierArticles ? this.dossierArticles + '/' : '') + titre + '.md'; }
  cheminMedia(nom) { return (this.dossierMedias ? this.dossierMedias + '/' : '') + nom; }

  /* Nom de fichier libre pour une nouvelle photo (« photo.jpg », sinon « photo-2.jpg »…). */
  nomMediaLibre(nom, reserves = new Set()) {
    const m = /^(.*?)(\.[a-z0-9]+)?$/i.exec(nom), base = m[1] || 'fichier', ext = (m[2] || '').toLowerCase();
    for (let i = 1; ; i++) {
      const n = i === 1 ? base + ext : `${base}-${i}${ext}`;
      if (!this.medias.has(n.toLowerCase()) && !reserves.has(n.toLowerCase())) return n;
    }
  }

  /* ---------------------------------------------------------------- écriture */

  async commit({message, ajouts = [], suppressions = []}) {
    if (!this.etat) await this.synchroniser();
    this.changerStatut('sync', 'Envoi à GitHub…');
    let r;
    try {
      r = await this.source.enregistrer({teteAttendue: this.etat.tete, arbreAttendu: this.etat.arbre, message, ajouts, suppressions});
    } catch (e) {
      this.changerStatut(e.code === 'reseau' ? 'hors-ligne' : 'erreur', e.message);
      throw e;
    }
    /* Mise à jour locale sans rien retélécharger : les empreintes sont calculées ici, comme Git le fait. */
    const touches = new Set([...suppressions, ...ajouts.map(a => a.chemin)]);
    const fichiers = this.etat.fichiers.filter(f => !touches.has(f.chemin));
    const nouveauxTextes = [], nouveauxMedias = [];
    for (const a of ajouts) {
      const sha = await empreinteGit(a.octets);
      fichiers.push({chemin: a.chemin, sha, taille: a.octets.length});
      if (this.estArticle(a.chemin)) { const t = new TextDecoder().decode(a.octets); this.textes.set(sha, t); nouveauxTextes.push([sha, t]); }
      else nouveauxMedias.push([sha, new Blob([a.octets], {type: a.type || ''})]);
    }
    if (!this.source.local) {
      await ecrireTout('textes', nouveauxTextes).catch(() => {});
      await ecrireTout('medias', nouveauxMedias).catch(() => {});
    }
    const presents = new Set(fichiers.map(f => f.sha));
    for (const f of fichiers) if (this.estArticle(f.chemin) && !this.textes.has(f.sha)) {
      /* ne devrait pas arriver ; par sécurité on resynchronise entièrement */
      this.etat = null;
      await this.synchroniser({force: true});
      return r;
    }
    for (const k of [...this.textes.keys()]) if (!presents.has(k)) this.textes.delete(k);
    this.etat = {tete: r.commit, arbre: r.arbre, fichiers};
    await this.sauver();
    this.construire();
    this.derniereSync = Date.now();
    this.changerStatut('ok');
    this.emettre('change');
    return r;
  }

  /* Publie une page (création ou modification), avec ses nouvelles photos, en un seul commit.
     shaDepart : empreinte de la page quand l'édition a commencé (null pour une création). */
  async publier({titre, texte, resume = '', shaDepart = null, medias = []}) {
    const v = verifierTitre(titre);
    if (v.erreur) throw new ErreurWiki('titre', v.erreur);
    titre = v.titre;
    for (let essai = 0; essai < 3; essai++) {
      await this.synchroniser();
      const existante = this.pages.get(cle(titre));
      if (!shaDepart && existante) throw new ErreurWiki('existe', `Une page « ${existante.titre} » existe déjà.`, {page: existante});
      if (shaDepart && existante && existante.sha !== shaDepart)
        throw new ErreurWiki('conflit', 'Cette page a été modifiée ailleurs pendant que tu l’écrivais.', {texteDistant: existante.texte});
      const chemin = existante?.chemin ?? this.cheminArticle(titre);
      const resumeNet = resume.replace(/\s+/g, ' ').trim();
      const message = resumeNet ? `${existante?.titre || titre} : ${resumeNet}` : `${existante ? 'Modifie' : 'Crée'} « ${existante?.titre || titre} »`;
      const ajouts = [{chemin, octets: texteVersOctets(texte)}, ...medias.map(m => ({chemin: this.cheminMedia(m.nom), octets: m.octets, type: m.type}))];
      try {
        await this.commit({message, ajouts});
        return this.page(existante?.titre || titre);
      } catch (e) {
        if (!(e instanceof ErreurGitHub) || e.code !== 'conflit') throw e;
        /* le dépôt a bougé : on se remet à jour, puis on vérifie que cette page-ci n'a pas changé */
      }
    }
    throw new ErreurWiki('conflit', 'Le wiki change sans arrêt ailleurs : réessaie dans un instant.');
  }

  /* Remplace les liens vers « ancien » par « nouveau » (section et texte affiché conservés). */
  static remplacerLiens(texte, ancien, nouveau) {
    const nom = echapperRegex(ancien).replace(/(\\ | |_)/g, '[ _]');
    const re = new RegExp(`(!?)\\[\\[[ \\t]*${nom}[ \\t]*(#[^\\]|\\n]*)?(\\|[^\\]\\n]*)?\\]\\]`, 'giu');
    return texte.replace(re, (m, img, section, aff) => img ? m : `[[${nouveau}${section || ''}${aff || ''}]]`);
  }

  async renommer(ancien, nouveau, {majLiens = true} = {}) {
    const v = verifierTitre(nouveau);
    if (v.erreur) throw new ErreurWiki('titre', v.erreur);
    nouveau = v.titre;
    for (let essai = 0; essai < 3; essai++) {
      await this.synchroniser();
      const page = this.pages.get(cle(ancien));
      if (!page) throw new ErreurWiki('absente', `La page « ${ancien} » n’existe plus.`);
      const deja = this.pages.get(cle(nouveau));
      if (deja && deja !== page) throw new ErreurWiki('existe', `Une page « ${deja.titre} » existe déjà.`);
      if (page.titre === nouveau) return page;
      const chemin = page.chemin.replace(/[^/]*$/, nouveau + '.md');
      let texte = page.texte;
      const ajouts = [];
      if (majLiens) {
        for (const source of this.retroliens(page.titre)) {
          const p = this.pages.get(cle(source));
          const t = Depot.remplacerLiens(p.texte, page.titre, nouveau);
          if (t !== p.texte) ajouts.push({chemin: p.chemin, octets: texteVersOctets(t)});
        }
        texte = Depot.remplacerLiens(texte, page.titre, nouveau);
      }
      ajouts.unshift({chemin, octets: texteVersOctets(texte)});
      const n = ajouts.length - 1;
      try {
        await this.commit({message: `Renomme « ${page.titre} » en « ${nouveau} »${n ? ` (liens corrigés dans ${n} page${n > 1 ? 's' : ''})` : ''}`, ajouts, suppressions: chemin === page.chemin ? [] : [page.chemin]});
        return this.page(nouveau);
      } catch (e) {
        if (!(e instanceof ErreurGitHub) || e.code !== 'conflit') throw e;
      }
    }
    throw new ErreurWiki('conflit', 'Le wiki change sans arrêt ailleurs : réessaie dans un instant.');
  }

  async supprimer(titre) {
    for (let essai = 0; essai < 3; essai++) {
      await this.synchroniser();
      const page = this.pages.get(cle(titre));
      if (!page) return;
      try { await this.commit({message: `Supprime « ${page.titre} »`, suppressions: [page.chemin]}); return; }
      catch (e) { if (!(e instanceof ErreurGitHub) || e.code !== 'conflit') throw e; }
    }
    throw new ErreurWiki('conflit', 'Le wiki change sans arrêt ailleurs : réessaie dans un instant.');
  }
}
