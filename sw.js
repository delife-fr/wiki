/* WIKI — service worker (version 1.0.0)
   Permet d'installer le wiki comme une appli et de l'ouvrir sans réseau.
   · Fichiers de l'appli (même site) : le réseau d'abord, pour avoir toujours la dernière version ; sans réseau,
     ou si le réseau ne répond pas en 3 secondes, la copie gardée. La copie est remise à jour à chaque réponse.
   · GitHub (api.github.com) et tout autre site : jamais interceptés. Le contenu du wiki est gardé par l'appli
     elle-même (IndexedDB), pas ici.
   · À chaque nouvelle version de l'appli, changer VERSION ci-dessous (et dans js/reglages.js). */
const VERSION = '1.0.0';
const CACHE = 'wiki-' + VERSION;
const FICHIERS = ['./', './index.html', './manifest.webmanifest', './css/wiki.css', './vendor/bibliotheques.js',
  './js/app.js', './js/aide.js', './js/analyse.js', './js/demo.js', './js/depot.js', './js/diff.js', './js/editeur.js',
  './js/github.js', './js/medias.js', './js/outils.js', './js/recherche.js', './js/reglages.js', './js/rendu.js',
  './js/stockage.js', './js/vues.js', './icones/favicon.svg', './icones/icone-180.png', './icones/icone-192.png', './icones/icone-512.png',
  './icones/icone-masque-512.png'];
const DELAI_RESEAU = 3000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FICHIERS.map(f => new Request(f, {cache: 'reload'})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(l => Promise.all(l.filter(k => k.startsWith('wiki-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const copieGardee = r => caches.match(r, {ignoreSearch: true}).then(x => x || (r.mode === 'navigate' ? caches.match('./index.html') : undefined));

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;
  const reseau = fetch(r, {cache: 'no-cache'}).then(rep => {
    if (rep.ok && rep.type === 'basic') { const copie = rep.clone(); caches.open(CACHE).then(c => c.put(r, copie)); }
    return rep;
  });
  e.waitUntil(reseau.catch(() => {}));
  e.respondWith(new Promise(ok => {
    let fini = false;
    const servir = x => { if (!fini && x) { fini = true; ok(x); } };
    const secours = () => copieGardee(r).then(x => { if (x) servir(x); else reseau.then(servir, () => servir(Response.error())); });
    const t = setTimeout(secours, DELAI_RESEAU);
    reseau.then(rep => { clearTimeout(t); servir(rep); }, () => { clearTimeout(t); copieGardee(r).then(x => servir(x || Response.error())); });
  }));
});
