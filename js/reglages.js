/* WIKI — réglages gardés sur l'appareil (la clé GitHub ne quitte jamais ce navigateur, sauf vers api.github.com). */

import {local} from './outils.js';

export const VERSION = '1.1.0';

const DEFAUT = {mode: null, proprietaire: 'delife-fr', depot: 'wiki-donnees', branche: 'main', jeton: '',
  dossierArticles: 'articles', dossierMedias: 'medias', theme: 'sombre'};

export const reglages = () => ({...DEFAUT, ...local.lire('wiki.reglages', {})});
export const enregistrerReglages = r => local.ecrire('wiki.reglages', r);

/* Comme LIFE PANEL : sombre par défaut, clair au choix (bouton soleil / lune de la barre du haut). */
export function appliquerTheme(theme) {
  const clair = theme === 'clair';
  document.documentElement.dataset.theme = clair ? 'clair' : 'sombre';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', clair ? '#f3f3f5' : '#1b1b1d');
}
