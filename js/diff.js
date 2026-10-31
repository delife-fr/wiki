/* WIKI — différences entre deux versions d'un article, ligne par ligne (plus longue sous-suite commune). */

import {esc} from './outils.js';

export function differences(avant, apres) {
  const a = avant.split('\n'), b = apres.split('\n');
  /* début et fin identiques mis de côté : le calcul ne porte que sur la partie modifiée */
  let debut = 0;
  while (debut < a.length && debut < b.length && a[debut] === b[debut]) debut++;
  let fa = a.length, fb = b.length;
  while (fa > debut && fb > debut && a[fa - 1] === b[fb - 1]) { fa--; fb--; }
  const x = a.slice(debut, fa), y = b.slice(debut, fb);
  const res = a.slice(0, debut).map(t => ({type: '=', t}));
  if (x.length * y.length > 4e6) {
    res.push(...x.map(t => ({type: '-', t})), ...y.map(t => ({type: '+', t})));
  } else {
    const n = x.length, m = y.length, L = Array.from({length: n + 1}, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { res.push({type: '=', t: x[i]}); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) res.push({type: '-', t: x[i++]});
      else res.push({type: '+', t: y[j++]});
    }
    while (i < n) res.push({type: '-', t: x[i++]});
    while (j < m) res.push({type: '+', t: y[j++]});
  }
  res.push(...a.slice(fa).map(t => ({type: '=', t})));
  return res;
}

/* Tableau des différences : 2 lignes de contexte autour de chaque changement, le reste replié. */
export function rendreDifferences(lignes, contexte = 2) {
  const garder = new Array(lignes.length).fill(false);
  lignes.forEach((l, i) => { if (l.type !== '=') for (let k = Math.max(0, i - contexte); k <= Math.min(lignes.length - 1, i + contexte); k++) garder[k] = true; });
  if (!garder.some(Boolean)) return '<p class="discret">Aucune différence de texte.</p>';
  let html = '', saut = 0, na = 0;
  const vider = () => { if (saut) html += `<tr class="saut"><td colspan="3">… ${saut} ligne${saut > 1 ? 's' : ''} sans changement …</td></tr>`; saut = 0; };
  lignes.forEach((l, i) => {
    if (l.type !== '+') na++;
    if (!garder[i]) { saut++; return; }
    vider();
    const cls = l.type === '+' ? 'ajout' : l.type === '-' ? 'retrait' : 'meme';
    html += `<tr class="${cls}"><td class="num">${l.type === '+' ? '' : na}</td><td class="signe">${l.type === '=' ? '' : l.type === '+' ? '+' : '−'}</td><td class="ligne">${esc(l.t) || '&nbsp;'}</td></tr>`;
  });
  vider();
  return `<div class="defile"><table class="differences"><tbody>${html}</tbody></table></div>`;
}
