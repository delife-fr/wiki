/* WIKI — photos et fichiers.
   · Affichage : le dépôt est privé, donc chaque photo est téléchargée avec la clé puis gardée sur l'appareil
     (rangée par empreinte Git : jamais retéléchargée tant qu'elle ne change pas).
   · Ajout : la photo est réduite (2000 pixels au plus, JPEG) avant l'envoi, pour rester légère. */

import {lire, ecrire} from './stockage.js';
import {extension} from './outils.js';

const urls = new Map();       /* empreinte → adresse blob: */
const enCours = new Map();    /* empreinte → promesse */

const TYPES = {jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  svg: 'image/svg+xml', bmp: 'image/bmp', pdf: 'application/pdf'};

export function urlMedia(depot, entree) {
  const sha = entree.sha;
  if (urls.has(sha)) return Promise.resolve(urls.get(sha));
  if (enCours.has(sha)) return enCours.get(sha);
  const p = (async () => {
    let blob = depot.source.local ? null : await lire('medias', sha).catch(() => null);
    if (!blob) {
      blob = await depot.source.media(sha);
      if (!depot.source.local) ecrire('medias', sha, blob).catch(() => {});
    }
    /* le bon type, pour que le navigateur affiche correctement (une image SVG surtout) */
    const type = TYPES[extension(entree.chemin)];
    if (type && blob.type !== type) blob = new Blob([blob], {type});
    const u = URL.createObjectURL(blob);
    urls.set(sha, u);
    return u;
  })().finally(() => enCours.delete(sha));
  enCours.set(sha, p);
  return p;
}

const COTE_MAX = 2000, QUALITE = 0.85, GARDER_SOUS = 400 * 1024;

/* Fichier choisi → {nom, octets, type, url} prêt à envoyer. */
export async function preparerFichier(fichier) {
  const nomBrut = (fichier.name || 'photo').normalize('NFC');
  const base = nomBrut.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|#^[\]]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 80) || 'photo';
  const ext = extension(nomBrut);
  const image = fichier.type.startsWith('image/') && !/svg|gif/.test(fichier.type);
  if (!image || (fichier.size <= GARDER_SOUS && ['jpg', 'jpeg', 'png', 'webp'].includes(ext))) {
    const octets = new Uint8Array(await fichier.arrayBuffer());
    return {nom: `${base}.${ext || 'bin'}`, octets, type: fichier.type || 'application/octet-stream', url: URL.createObjectURL(fichier)};
  }
  const url = URL.createObjectURL(fichier);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const r = Math.min(1, COTE_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * r); c.height = Math.round(img.naturalHeight * r);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);   /* fond blanc pour les PNG transparents */
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', QUALITE));
    if (!blob) throw new Error('compression impossible');
    if (blob.size >= fichier.size && ['jpg', 'jpeg'].includes(ext)) {
      return {nom: `${base}.${ext}`, octets: new Uint8Array(await fichier.arrayBuffer()), type: fichier.type, url};
    }
    URL.revokeObjectURL(url);
    return {nom: `${base}.jpg`, octets: new Uint8Array(await blob.arrayBuffer()), type: 'image/jpeg', url: URL.createObjectURL(blob)};
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(`Format de photo non reconnu par ce navigateur (${nomBrut}).`);
  }
}
