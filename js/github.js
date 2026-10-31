/* WIKI — accès au dépôt privé sur GitHub.
   · Lecture groupée : la liste des fichiers en une demande (REST « git/trees »), puis le texte de 50 articles
     par demande (GraphQL). Si GraphQL est refusé, repli automatique : un article par demande (REST).
   · Écriture groupée : un seul commit pour plusieurs fichiers (GraphQL « createCommitOnBranch »), refusé si le
     dépôt a changé entre-temps. Repli automatique : API Git de REST (blobs → arbre → commit → branche).
   · La clé n'est envoyée qu'à api.github.com. */

import {octetsVersBase64, local} from './outils.js';

const API = 'https://api.github.com';
const DELAI = 30000;
const LOT = 50;
const HEX = /^[0-9a-f]{40}$/;

export class ErreurGitHub extends Error {
  /* code : cle | acces | introuvable | vide | conflit | reseau | limite | autre */
  constructor(code, message, statut) { super(message); this.code = code; this.statut = statut; }
}

const MESSAGES = {
  cle: 'Clé GitHub refusée : elle est fausse ou a expiré. Colle une nouvelle clé dans les Réglages.',
  acces: 'Accès refusé : la clé n\'a pas le droit d\'écrire dans ce dépôt (permission « Contents : Read and write »).',
  introuvable: 'Dépôt introuvable : vérifie son nom dans les Réglages, et que la clé donne accès à ce dépôt.',
  vide: 'Le dépôt est vide : ajoute-lui un README sur GitHub, puis réessaie.',
  conflit: 'Le wiki a été modifié ailleurs entre-temps.',
  reseau: 'Pas de connexion à GitHub.',
  limite: 'Trop de demandes envoyées à GitHub : réessaie dans quelques minutes.',
};

export class SourceGitHub {
  constructor({proprietaire, depot, branche, jeton}) {
    this.p = proprietaire; this.n = depot; this.b = branche || 'main'; this.jeton = jeton;
    this.base = `/repos/${encodeURIComponent(proprietaire)}/${encodeURIComponent(depot)}`;
    this.modeLecture = local.lire('wiki.github.lecture', 'graphql');
    this.modeEcriture = local.lire('wiki.github.ecriture', 'graphql');
  }

  get nom() { return `${this.p}/${this.n}`; }

  async appel(url, {methode = 'GET', corps, accept = 'application/vnd.github+json', frais = false} = {}) {
    const ctrl = new AbortController();
    const minuterie = setTimeout(() => ctrl.abort(), DELAI);
    let rep;
    try {
      rep = await fetch(url.startsWith('http') ? url : API + url, {
        method: methode, signal: ctrl.signal, cache: frais ? 'no-cache' : 'default',
        headers: {
          'Authorization': 'Bearer ' + this.jeton, 'Accept': accept, 'X-GitHub-Api-Version': '2022-11-28',
          ...(corps ? {'Content-Type': 'application/json'} : {}),
        },
        body: corps ? JSON.stringify(corps) : undefined,
      });
    } catch {
      throw new ErreurGitHub('reseau', ctrl.signal.aborted ? 'GitHub ne répond pas.' : MESSAGES.reseau);
    } finally { clearTimeout(minuterie); }
    if (rep.ok) return rep;
    let detail = '';
    try { detail = (await rep.json()).message || ''; } catch { /* corps vide */ }
    const s = rep.status;
    if (s === 401) throw new ErreurGitHub('cle', MESSAGES.cle, s);
    if ((s === 403 || s === 429) && (rep.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(detail))) throw new ErreurGitHub('limite', MESSAGES.limite, s);
    if (s === 403) throw new ErreurGitHub('acces', MESSAGES.acces, s);
    if (s === 404) throw new ErreurGitHub('introuvable', MESSAGES.introuvable, s);
    if (s === 409 && /empty/i.test(detail)) throw new ErreurGitHub('vide', MESSAGES.vide, s);
    if (s === 409 || (s === 422 && /fast.forward|reference|update/i.test(detail))) throw new ErreurGitHub('conflit', MESSAGES.conflit, s);
    throw new ErreurGitHub('autre', `GitHub a répondu ${s}${detail ? ' : ' + detail : ''}.`, s);
  }

  async json(url, options) { return (await this.appel(url, options)).json(); }

  async graphql(requete, variables = {}) {
    const r = await this.json('/graphql', {methode: 'POST', corps: {query: requete, variables}});
    if (r.errors?.length) {
      const e = r.errors[0], msg = e.message || 'erreur GraphQL';
      if (e.type === 'NOT_FOUND') throw new ErreurGitHub('introuvable', MESSAGES.introuvable);
      if (e.type === 'FORBIDDEN' || /not accessible|permission/i.test(msg)) throw new ErreurGitHub('acces', MESSAGES.acces);
      if (e.type === 'STALE_DATA' || /expected .*(head|branch)|is at .* but expected|stale/i.test(msg)) throw new ErreurGitHub('conflit', MESSAGES.conflit);
      throw new ErreurGitHub('graphql', msg);
    }
    return r.data;
  }

  memoriser(cle, valeur) { this[cle] = valeur; local.ecrire('wiki.github.' + (cle === 'modeLecture' ? 'lecture' : 'ecriture'), valeur); }

  /* Dernier commit de la branche et son arbre. */
  async tete() {
    if (this.modeLecture === 'graphql') {
      try {
        const d = await this.graphql(`query($p:String!,$n:String!,$r:String!){repository(owner:$p,name:$n){ref(qualifiedName:$r){target{oid ... on Commit{tree{oid}}}}}}`,
          {p: this.p, n: this.n, r: 'refs/heads/' + this.b});
        if (!d.repository) throw new ErreurGitHub('introuvable', MESSAGES.introuvable);
        const t = d.repository.ref?.target;
        if (!t) throw new ErreurGitHub('vide', d.repository ? MESSAGES.vide : MESSAGES.introuvable);
        return {commit: t.oid, arbre: t.tree.oid};
      } catch (e) {
        if (e.code !== 'graphql' && e.code !== 'acces') throw e;
        this.memoriser('modeLecture', 'rest');
      }
    }
    const c = await this.json(`${this.base}/commits/${encodeURIComponent(this.b)}`, {frais: true});
    return {commit: c.sha, arbre: c.commit.tree.sha};
  }

  /* Tous les fichiers du dépôt (une seule demande). */
  async arbre(arbreSha) {
    const r = await this.json(`${this.base}/git/trees/${arbreSha}?recursive=1`);
    if (r.truncated) console.warn('Liste des fichiers tronquée par GitHub (plus de 100 000 fichiers).');
    return r.tree.filter(e => e.type === 'blob').map(e => ({chemin: e.path, sha: e.sha, taille: e.size}));
  }

  /* Texte de plusieurs fichiers : Map empreinte → texte. */
  async textes(shas, progression) {
    const res = new Map(), liste = [...new Set(shas)].filter(s => HEX.test(s));
    let faits = 0;
    const lots = [];
    for (let i = 0; i < liste.length; i += LOT) lots.push(liste.slice(i, i + LOT));
    const unLot = async lot => {
      if (this.modeLecture === 'graphql') {
        try {
          const champs = lot.map((s, i) => `b${i}:object(oid:"${s}"){... on Blob{text isTruncated}}`).join(' ');
          const d = await this.graphql(`query($p:String!,$n:String!){repository(owner:$p,name:$n){${champs}}}`, {p: this.p, n: this.n});
          const restants = [];
          lot.forEach((s, i) => {
            const b = d.repository?.['b' + i];
            if (b && typeof b.text === 'string' && !b.isTruncated) res.set(s, b.text); else restants.push(s);
          });
          for (const s of restants) res.set(s, await this.texteBlob(s));
          faits += lot.length; progression?.(faits, liste.length);
          return;
        } catch (e) {
          if (e.code !== 'graphql' && e.code !== 'acces') throw e;
          this.memoriser('modeLecture', 'rest');
        }
      }
      for (const s of lot) { res.set(s, await this.texteBlob(s)); faits++; progression?.(faits, liste.length); }
    };
    /* 3 lots en parallèle au plus */
    let i = 0;
    await Promise.all(Array.from({length: Math.min(3, lots.length)}, async () => { while (i < lots.length) await unLot(lots[i++]); }));
    return res;
  }

  async texteBlob(sha) {
    const rep = await this.appel(`${this.base}/git/blobs/${sha}`, {accept: 'application/vnd.github.raw+json'});
    return new TextDecoder().decode(await rep.arrayBuffer());
  }

  async media(sha) {
    const rep = await this.appel(`${this.base}/git/blobs/${sha}`, {accept: 'application/vnd.github.raw+json'});
    return rep.blob();
  }

  /* Un commit : ajouts [{chemin, octets}], suppressions [chemin]. Renvoie {commit, arbre}. */
  async enregistrer({teteAttendue, arbreAttendu, message, ajouts = [], suppressions = []}) {
    const [titre, ...reste] = message.split('\n');
    if (this.modeEcriture === 'graphql') {
      try {
        const d = await this.graphql(`mutation($e:CreateCommitOnBranchInput!){createCommitOnBranch(input:$e){commit{oid tree{oid}}}}`, {e: {
          branch: {repositoryNameWithOwner: this.nom, branchName: this.b},
          expectedHeadOid: teteAttendue,
          message: {headline: titre, ...(reste.join('\n').trim() ? {body: reste.join('\n').trim()} : {})},
          fileChanges: {
            additions: ajouts.map(a => ({path: a.chemin, contents: octetsVersBase64(a.octets)})),
            deletions: suppressions.map(chemin => ({path: chemin})),
          },
        }});
        const c = d.createCommitOnBranch.commit;
        return {commit: c.oid, arbre: c.tree.oid};
      } catch (e) {
        if (e.code === 'conflit' || e.code === 'reseau' || e.code === 'cle' || e.code === 'limite') throw e;
        /* refus ou erreur inattendue de GraphQL : on vérifie que le dépôt n'a pas bougé, puis on passe par REST */
        const t = await this.tete();
        if (t.commit !== teteAttendue) throw new ErreurGitHub('conflit', MESSAGES.conflit);
        arbreAttendu = t.arbre;
        this.memoriser('modeEcriture', 'rest');
      }
    }
    return this.enregistrerRest({teteAttendue, arbreAttendu, message, ajouts, suppressions});
  }

  async enregistrerRest({teteAttendue, arbreAttendu, message, ajouts, suppressions}) {
    if (!arbreAttendu) arbreAttendu = (await this.json(`${this.base}/git/commits/${teteAttendue}`)).tree.sha;
    const entrees = [];
    for (const a of ajouts) {
      const b = await this.json(`${this.base}/git/blobs`, {methode: 'POST', corps: {content: octetsVersBase64(a.octets), encoding: 'base64'}});
      entrees.push({path: a.chemin, mode: '100644', type: 'blob', sha: b.sha});
    }
    for (const chemin of suppressions) entrees.push({path: chemin, mode: '100644', type: 'blob', sha: null});
    const arbre = await this.json(`${this.base}/git/trees`, {methode: 'POST', corps: {base_tree: arbreAttendu, tree: entrees}});
    const commit = await this.json(`${this.base}/git/commits`, {methode: 'POST', corps: {message, tree: arbre.sha, parents: [teteAttendue]}});
    /* force:false : GitHub refuse si la branche a avancé depuis teteAttendue */
    await this.json(`${this.base}/git/refs/heads/${encodeURIComponent(this.b)}`, {methode: 'PATCH', corps: {sha: commit.sha, force: false}});
    return {commit: commit.sha, arbre: arbre.sha};
  }

  /* Historique d'un fichier. */
  async historique(chemin, page = 1) {
    const l = await this.json(`${this.base}/commits?sha=${encodeURIComponent(this.b)}&path=${encodeURIComponent(chemin)}&per_page=50&page=${page}`, {frais: true});
    return l.map(c => ({sha: c.sha, date: c.commit.author?.date || c.commit.committer?.date, auteur: c.author?.login || c.commit.author?.name || '', message: c.commit.message}));
  }

  /* Texte d'un fichier à un commit donné (null si le fichier n'existait pas). */
  async version(chemin, commitSha) {
    try {
      const rep = await this.appel(`${this.base}/contents/${chemin.split('/').map(encodeURIComponent).join('/')}?ref=${commitSha}`, {accept: 'application/vnd.github.raw+json'});
      return new TextDecoder().decode(await rep.arrayBuffer());
    } catch (e) { if (e.code === 'introuvable') return null; throw e; }
  }

  /* Derniers commits du dépôt. */
  async recentes(nombre = 30) {
    const l = await this.json(`${this.base}/commits?sha=${encodeURIComponent(this.b)}&per_page=${nombre}`, {frais: true});
    return l.map(c => ({sha: c.sha, date: c.commit.author?.date || c.commit.committer?.date, auteur: c.author?.login || c.commit.author?.name || '', message: c.commit.message}));
  }

  /* Fichiers touchés par un commit : [{chemin, etat, ancien}] */
  async fichiersCommit(sha) {
    const c = await this.json(`${this.base}/commits/${sha}`);
    return (c.files || []).map(f => ({chemin: f.filename, etat: f.status, ancien: f.previous_filename}));
  }
}
