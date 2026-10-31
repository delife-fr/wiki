/* WIKI — réglages gardés sur l'appareil (la clé GitHub ne quitte jamais ce navigateur, sauf vers api.github.com). */

import {local} from './outils.js';

export const VERSION = '1.0.0';

const DEFAUT = {mode: null, proprietaire: 'delife-fr', depot: 'wiki-donnees', branche: 'main', jeton: '',
  dossierArticles: 'articles', dossierMedias: 'medias', theme: 'auto'};

export const reglages = () => ({...DEFAUT, ...local.lire('wiki.reglages', {})});
export const enregistrerReglages = r => local.ecrire('wiki.reglages', r);

export function appliquerTheme(theme) {
  const h = document.documentElement;
  if (theme === 'clair' || theme === 'sombre') h.dataset.theme = theme; else delete h.dataset.theme;
  const sombre = theme === 'sombre' || (theme !== 'clair' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', sombre ? '#101418' : '#f8f9fa');
}
