/* WIKI — cache sur l'appareil (IndexedDB).
   · « etat »   : l'état connu du dépôt (dernier commit, liste des fichiers) et le dépôt de démonstration.
   · « textes » : le texte des articles, rangé par empreinte Git (un texte ne change jamais pour une empreinte donnée).
   · « medias » : les photos et fichiers déjà téléchargés, rangés par empreinte Git.
   Si IndexedDB est indisponible (navigation privée stricte), tout reste en mémoire le temps de la session. */

const NOM = 'wiki', VERSION = 1, MAGASINS = ['etat', 'textes', 'medias'];
let base = null, memoire = null;

function ouvrir() {
  if (base) return base;
  base = new Promise(ok => {
    let r;
    try { r = indexedDB.open(NOM, VERSION); } catch { ok(null); return; }
    r.onupgradeneeded = () => { for (const m of MAGASINS) if (!r.result.objectStoreNames.contains(m)) r.result.createObjectStore(m); };
    r.onsuccess = () => {
      /* une autre fenêtre veut mettre à jour ou effacer la base : on libère la connexion */
      r.result.onversionchange = () => { r.result.close(); base = null; };
      ok(r.result);
    };
    r.onerror = () => ok(null);
    r.onblocked = () => ok(null);
  });
  return base;
}

const enMemoire = m => { memoire ??= Object.fromEntries(MAGASINS.map(k => [k, new Map()])); return memoire[m]; };

async function transaction(magasin, mode, fn) {
  const db = await ouvrir();
  if (!db) return fn(null, enMemoire(magasin));
  return new Promise((ok, ko) => {
    let res;
    try {
      const t = db.transaction(magasin, mode);
      res = fn(t.objectStore(magasin), null);
      t.oncomplete = () => ok(res && 'result' in res ? res.result : res);
      t.onerror = () => ko(t.error);
      t.onabort = () => ko(t.error || new Error('Écriture annulée (stockage plein ?)'));
    } catch (e) { ko(e); }
  });
}

export const lire = (magasin, k) => transaction(magasin, 'readonly', (s, m) => m ? m.get(k) : s.get(k));
export const ecrire = (magasin, k, v) => transaction(magasin, 'readwrite', (s, m) => { m ? m.set(k, v) : s.put(v, k); });
export const effacer = (magasin, k) => transaction(magasin, 'readwrite', (s, m) => { m ? m.delete(k) : s.delete(k); });

/* Plusieurs écritures d'un coup : [[clé, valeur], …] */
export const ecrireTout = (magasin, paires) => transaction(magasin, 'readwrite', (s, m) => {
  for (const [k, v] of paires) m ? m.set(k, v) : s.put(v, k);
});

/* Plusieurs lectures d'un coup : renvoie une Map clé → valeur (les absents sont omis). */
export async function lireTout(magasin, cles) {
  const res = new Map();
  if (!cles.length) return res;
  await transaction(magasin, 'readonly', (s, m) => {
    for (const k of cles) {
      if (m) { if (m.has(k)) res.set(k, m.get(k)); continue; }
      const r = s.get(k);
      r.onsuccess = () => { if (r.result !== undefined) res.set(k, r.result); };
    }
  });
  return res;
}

/* Garde seulement les clés listées (nettoyage des anciens textes). */
export const garderSeulement = (magasin, aGarder) => transaction(magasin, 'readwrite', (s, m) => {
  if (m) { for (const k of [...m.keys()]) if (!aGarder.has(k)) m.delete(k); return; }
  const r = s.openKeyCursor ? s.openKeyCursor() : s.openCursor();
  r.onsuccess = () => {
    const c = r.result;
    if (!c) return;
    if (!aGarder.has(c.key)) s.delete(c.key);
    c.continue();
  };
});

export async function toutVider() {
  for (const m of MAGASINS) await transaction(m, 'readwrite', (s, mem) => { mem ? mem.clear() : s.clear(); });
}
