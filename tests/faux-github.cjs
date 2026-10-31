/* Faux api.github.com pour les tests : un petit dépôt Git en mémoire (vraies empreintes SHA-1),
   les points d'accès REST et GraphQL utilisés par l'appli, et la validation de chaque requête GraphQL
   contre le schéma public de GitHub. */
const crypto = require('crypto');
const valider = require('./valider-graphql.cjs');

const sha1 = b => crypto.createHash('sha1').update(b).digest('hex');
const blobSha = buf => sha1(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf]));

class FauxGitHub {
  constructor({proprietaire = 'delife-fr', depot = 'wiki-donnees', cle = 'cle-de-test'} = {}) {
    this.p = proprietaire; this.n = depot; this.cle = cle;
    this.blobs = new Map(); this.arbres = new Map(); this.commits = new Map();
    this.tete = null; this.graphqlInterdit = false; this.horsLigne = false;
    this.journal = []; this.erreursSchema = []; this.inattendus = [];
    this.horloge = Date.parse('2026-10-01T10:00:00Z');
  }
  ajouterBlob(buf) { const s = blobSha(buf); this.blobs.set(s, buf); return s; }
  arbreDe(fichiers) { const s = sha1('arbre:' + JSON.stringify([...fichiers].sort())); this.arbres.set(s, new Map(fichiers)); return s; }
  fichiers(commit = this.tete) { return commit ? this.arbres.get(this.commits.get(commit).arbre) : new Map(); }
  /* commit direct (simule une modification faite ailleurs) : {chemin: texte|Buffer|null} */
  commit(changements, message = 'modif', auteur = 'ailleurs') {
    const f = new Map(this.fichiers());
    for (const [c, v] of Object.entries(changements)) {
      if (v === null) f.delete(c); else f.set(c, this.ajouterBlob(Buffer.isBuffer(v) ? v : Buffer.from(v)));
    }
    return this.creerCommit(this.arbreDe(f), this.tete ? [this.tete] : [], message, auteur, true);
  }
  creerCommit(arbre, parents, message, auteur = 'delife-fr', avancer = false) {
    this.horloge += 60000;
    const date = new Date(this.horloge).toISOString();
    const s = sha1(`commit:${arbre}:${parents.join(',')}:${message}:${date}:${Math.random()}`);
    this.commits.set(s, {arbre, parents, message, date, auteur});
    if (avancer) this.tete = s;
    return s;
  }
  texte(chemin) { const s = this.fichiers().get(chemin); return s ? this.blobs.get(s).toString('utf8') : null; }
  compter(type) { return this.journal.filter(j => j.startsWith(type)).length; }
  vider() { this.journal = []; }

  async installer(cible) {
    await cible.route('https://api.github.com/**', route => this.repondre(route));
  }

  async repondre(route) {
    const r = route.request();
    if (this.horsLigne) return route.abort('internetdisconnected');
    const u = new URL(r.url()), m = r.method();
    const json = (corps, statut = 200, entetes = {}) => route.fulfill({status: statut, contentType: 'application/json',
      headers: {'access-control-allow-origin': '*', ...entetes}, body: JSON.stringify(corps)});
    const brut = (buf, statut = 200) => route.fulfill({status: statut, contentType: 'application/octet-stream', headers: {'access-control-allow-origin': '*'}, body: buf});
    if (m === 'OPTIONS') return route.fulfill({status: 204, headers: {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}});
    if (r.headers()['authorization'] !== 'Bearer ' + this.cle) { this.journal.push('401'); return json({message: 'Bad credentials'}, 401); }
    const base = `/repos/${this.p}/${this.n}`;
    const chemin = decodeURIComponent(u.pathname);

    if (chemin === '/graphql' && m === 'POST') {
      const {query, variables} = JSON.parse(r.postData());
      const err = valider(query, variables);
      if (err.length) { this.erreursSchema.push({query, err}); return json({errors: err.map(message => ({message}))}); }
      if (this.graphqlInterdit) { this.journal.push('graphql-refus'); return json({data: null, errors: [{type: 'FORBIDDEN', message: 'Resource not accessible by personal access token'}]}); }
      if (variables.p && (variables.p !== this.p || variables.n !== this.n)) return json({data: {repository: null}, errors: [{type: 'NOT_FOUND', message: 'Could not resolve to a Repository'}]});
      if (query.includes('createCommitOnBranch')) {
        this.journal.push('graphql-commit');
        const e = variables.e;
        if (e.expectedHeadOid !== this.tete) return json({data: {createCommitOnBranch: null}, errors: [{type: 'STALE_DATA', message: `Expected branch to point to "${e.expectedHeadOid}" but it did not. Pull and try again.`}]});
        const f = new Map(this.fichiers());
        for (const a of e.fileChanges.additions || []) f.set(a.path, this.ajouterBlob(Buffer.from(a.contents, 'base64')));
        for (const d of e.fileChanges.deletions || []) f.delete(d.path);
        const arbre = this.arbreDe(f);
        const s = this.creerCommit(arbre, [this.tete], e.message.headline + (e.message.body ? '\n\n' + e.message.body : ''), 'delife-fr', true);
        this.dernierCommit = {fichiers: (e.fileChanges.additions || []).length + (e.fileChanges.deletions || []).length};
        return json({data: {createCommitOnBranch: {commit: {oid: s, tree: {oid: arbre}}}}});
      }
      if (query.includes('ref(qualifiedName')) {
        this.journal.push('graphql-tete');
        return json({data: {repository: {ref: this.tete ? {target: {oid: this.tete, tree: {oid: this.commits.get(this.tete).arbre}}} : null}}});
      }
      if (query.includes('object(oid:')) {
        this.journal.push('graphql-textes');
        const repo = {};
        for (const x of query.matchAll(/(b\d+):object\(oid:"([0-9a-f]{40})"\)/g)) {
          const b = this.blobs.get(x[2]);
          repo[x[1]] = b ? {text: b.toString('utf8'), isTruncated: false} : null;
        }
        return json({data: {repository: repo}});
      }
      this.inattendus.push('graphql ' + query.slice(0, 80));
      return json({errors: [{message: 'requête inconnue du faux GitHub'}]});
    }

    if (!chemin.startsWith(base + '/')) { this.inattendus.push(m + ' ' + chemin); return json({message: 'Not Found'}, 404); }
    const reste = chemin.slice(base.length);
    let x;
    if (m === 'GET' && (x = /^\/commits\/(main)$/.exec(reste))) {
      this.journal.push('rest-tete');
      return json({sha: this.tete, commit: {tree: {sha: this.commits.get(this.tete).arbre}}});
    }
    if (m === 'GET' && (x = /^\/git\/trees\/([0-9a-f]{40})$/.exec(reste))) {
      this.journal.push('rest-arbre');
      const a = this.arbres.get(x[1]);
      if (!a) return json({message: 'Not Found'}, 404);
      const tree = [];
      const dossiers = new Set();
      for (const [p, s] of a) { tree.push({path: p, mode: '100644', type: 'blob', sha: s, size: this.blobs.get(s).length}); p.split('/').slice(0, -1).forEach((_, i, l) => dossiers.add(l.slice(0, i + 1).join('/'))); }
      for (const d of dossiers) tree.push({path: d, mode: '040000', type: 'tree', sha: sha1('d' + d)});
      return json({sha: x[1], tree, truncated: false});
    }
    if (m === 'GET' && (x = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(reste))) {
      this.journal.push('rest-blob');
      const b = this.blobs.get(x[1]);
      return b ? brut(b) : json({message: 'Not Found'}, 404);
    }
    if (m === 'GET' && (x = /^\/git\/commits\/([0-9a-f]{40})$/.exec(reste))) {
      const c = this.commits.get(x[1]); return c ? json({sha: x[1], tree: {sha: c.arbre}}) : json({message: 'Not Found'}, 404);
    }
    if (m === 'POST' && reste === '/git/blobs') {
      this.journal.push('rest-ecriture');
      const d = JSON.parse(r.postData()); return json({sha: this.ajouterBlob(Buffer.from(d.content, d.encoding === 'base64' ? 'base64' : 'utf8'))}, 201);
    }
    if (m === 'POST' && reste === '/git/trees') {
      this.journal.push('rest-ecriture');
      const d = JSON.parse(r.postData()); const f = new Map(this.arbres.get(d.base_tree));
      for (const e of d.tree) { if (e.sha === null) f.delete(e.path); else f.set(e.path, e.sha || this.ajouterBlob(Buffer.from(e.content))); }
      return json({sha: this.arbreDe(f)}, 201);
    }
    if (m === 'POST' && reste === '/git/commits') {
      this.journal.push('rest-ecriture');
      const d = JSON.parse(r.postData()); return json({sha: this.creerCommit(d.tree, d.parents, d.message)}, 201);
    }
    if (m === 'PATCH' && reste === '/git/refs/heads/main') {
      this.journal.push('rest-ecriture');
      const d = JSON.parse(r.postData()); const c = this.commits.get(d.sha);
      if (!c || (c.parents[0] !== this.tete && !d.force)) return json({message: 'Update is not a fast forward'}, 422);
      this.tete = d.sha; return json({ref: 'refs/heads/main', object: {sha: d.sha}});
    }
    if (m === 'GET' && reste === '/commits') {
      this.journal.push('rest-historique');
      const voulu = u.searchParams.get('path'), n = +(u.searchParams.get('per_page') || 30);
      const res = [];
      for (let s = this.tete; s && res.length < n; s = this.commits.get(s).parents[0]) {
        const c = this.commits.get(s);
        if (voulu) {
          const avant = c.parents[0] ? this.fichiers(c.parents[0]).get(voulu) : undefined;
          if (this.arbres.get(c.arbre).get(voulu) === avant) continue;
        }
        res.push({sha: s, commit: {message: c.message, author: {name: c.auteur, date: c.date}}, author: {login: c.auteur}});
      }
      return json(res);
    }
    if (m === 'GET' && (x = /^\/commits\/([0-9a-f]{40})$/.exec(reste))) {
      this.journal.push('rest-details');
      const c = this.commits.get(x[1]); if (!c) return json({message: 'Not Found'}, 404);
      const a = this.arbres.get(c.arbre), b = c.parents[0] ? this.fichiers(c.parents[0]) : new Map(), files = [];
      for (const [p, s] of a) if (b.get(p) !== s) files.push({filename: p, status: b.has(p) ? 'modified' : 'added'});
      for (const p of b.keys()) if (!a.has(p)) files.push({filename: p, status: 'removed'});
      return json({sha: x[1], files});
    }
    if (m === 'GET' && (x = /^\/contents\/(.+)$/.exec(reste))) {
      this.journal.push('rest-version');
      const s = this.fichiers(u.searchParams.get('ref')).get(x[1]);
      return s ? brut(this.blobs.get(s)) : json({message: 'Not Found'}, 404);
    }
    this.inattendus.push(m + ' ' + chemin + u.search);
    return json({message: 'Not Found'}, 404);
  }
}
module.exports = {FauxGitHub, blobSha};
