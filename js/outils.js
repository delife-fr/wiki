/* WIKI — petites fonctions partagées. */

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export const sansAccents = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/* Clé d'un titre : majuscules, espaces multiples et « _ » ignorés (comme Wikipédia et Obsidian) ; les accents comptent. */
export const cle = t => String(t ?? '').normalize('NFC').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase('fr');

/* Texte comparable pour la recherche : sans accents, en minuscules. Même longueur que l'original (une lettre → une lettre). */
export const pourRecherche = s => Array.from(String(s ?? '').normalize('NFC'), c => {
  const b = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (b.length === c.length) return b;
  const m = c.toLowerCase();
  return m.length === c.length ? m : c;
}).join('');

/* Identifiant de section (ancre) à partir d'un titre de section. */
export const ancre = t => 's-' + (sansAccents(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section');

export const titreDepuisChemin = chemin => chemin.split('/').pop().replace(/\.md$/i, '');
export const nomDepuisChemin = chemin => chemin.split('/').pop();
export const extension = nom => ((/\.([a-z0-9]{1,8})$/i.exec(nom) || [])[1] || '').toLowerCase();
export const EXT_IMAGES = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp']);
export const estImage = nom => EXT_IMAGES.has(extension(nom));

/* Caractères refusés dans un titre (ils posent problème dans un nom de fichier ou dans un lien [[ ]]). */
export const INTERDITS = /[\\/:*?"<>|#^[\]]/;
export function verifierTitre(t) {
  const titre = String(t ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!titre) return {erreur: 'Donne un titre à la page.'};
  if (INTERDITS.test(titre)) return {erreur: 'Le titre ne peut pas contenir ces caractères : \\ / : * ? " < > | # ^ [ ]'};
  if (titre.startsWith('.')) return {erreur: 'Le titre ne peut pas commencer par un point.'};
  if (titre.length > 120) return {erreur: 'Titre trop long (120 caractères au plus).'};
  return {titre};
}

/* Titres dans l'adresse : espaces → « _ » comme sur Wikipédia. */
export const encoderTitre = t => encodeURIComponent(String(t).replace(/ /g, '_'));
export const decoderTitre = s => { try { return decodeURIComponent(s).replace(/_/g, ' '); } catch { return String(s).replace(/_/g, ' '); } };
export const lienPage = (t, section) => '#/page/' + encoderTitre(t) + (section ? '#' + ancre(section) : '');

const FMT_DATE = new Intl.DateTimeFormat('fr-FR', {day: 'numeric', month: 'long', year: 'numeric'});
const FMT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'});
const FMT_HEURE = new Intl.DateTimeFormat('fr-FR', {hour: '2-digit', minute: '2-digit'});
export const dateLongue = d => d ? FMT_DATE.format(new Date(d)) : '';
export const dateHeure = d => d ? FMT_DATE_HEURE.format(new Date(d)) : '';
export const heure = d => d ? FMT_HEURE.format(new Date(d)) : '';

export const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

/* Octets ↔ base64 (par morceaux : un gros fichier ne fait pas déborder la pile). */
export function octetsVersBase64(octets) {
  let s = '';
  for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
  return btoa(s);
}
export const texteVersOctets = t => new TextEncoder().encode(t);

/* Empreinte Git d'un fichier (SHA-1 de « blob <taille>\0<contenu> ») : permet de garder en cache ce qu'on vient
   d'envoyer sans le retélécharger. */
export async function empreinteGit(octets) {
  const tete = new TextEncoder().encode(`blob ${octets.length}\0`);
  const tout = new Uint8Array(tete.length + octets.length);
  tout.set(tete); tout.set(octets, tete.length);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', tout));
  return Array.from(h, b => b.toString(16).padStart(2, '0')).join('');
}

export const attendre = ms => new Promise(r => setTimeout(r, ms));

export function delai(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* localStorage protégé (navigation privée, stockage bloqué). */
export const local = {
  lire(k, defaut = null) { try { const v = localStorage.getItem(k); return v === null ? defaut : JSON.parse(v); } catch { return defaut; } },
  ecrire(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  effacer(k) { try { localStorage.removeItem(k); } catch { /* rien */ } },
  cles(prefixe) { try { return Object.keys(localStorage).filter(k => k.startsWith(prefixe)); } catch { return []; } },
};

/* Tri alphabétique français (accents et majuscules bien placés). */
export const comparer = new Intl.Collator('fr', {sensitivity: 'base', numeric: true}).compare;
