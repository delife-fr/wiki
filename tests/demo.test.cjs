const { chromium } = require('playwright');
const URL0 = process.env.WIKI_URL || 'http://127.0.0.1:8765/';
const ok = (c, m) => { if (!c) { throw new Error('ÉCHEC : ' + m); } console.log('✓ ' + m); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport: {width: 1280, height: 900}});
  const p = await ctx.newPage();
  const erreurs = [];
  p.on('console', m => { if (m.type() === 'error') erreurs.push(m.text()); });
  p.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
  p.on('dialog', d => d.accept());
  await p.goto(URL0);
  await p.click('#essayer-demo');
  await p.waitForSelector('text=démo du wiki');
  ok(!(await p.isVisible('#mise-a-jour')), 'pas de bandeau « nouvelle version » à la première ouverture');

  // 1. créer « Islande » depuis le lien rouge
  await p.goto(URL0 + '#/page/Voyage_en_Islande');
  await p.click('.encadre a.nouveau:text("Islande")');
  await p.waitForSelector('#texte');
  ok((await p.inputValue('#texte')).includes('**Islande**'), 'éditeur ouvert avec le modèle');
  await p.click('#texte'); await p.keyboard.press('Control+End');
  await p.keyboard.type('est un pays. Voir [[Voy');
  await p.waitForSelector('.suggestions-liens:not([hidden]) li');
  ok((await p.textContent('.suggestions-liens li')) === 'Voyage en Islande', 'propositions de titres après [[');
  await p.keyboard.press('Enter');
  ok((await p.inputValue('#texte')).includes('[[Voyage en Islande]]'), 'titre inséré avec ]]');
  await p.click('[data-mode="apercu"]');
  ok(await p.isVisible('.apercu a.wl[data-titre="Voyage en Islande"]'), 'aperçu avec lien bleu');
  await p.click('[data-mode="ecrire"]');
  await p.fill('#resume', 'première version');
  await p.click('#publier');
  await p.waitForSelector('h1:text-is("Islande")');
  ok(await p.isVisible('.toast.succes'), 'page créée + message');
  await p.goto(URL0 + '#/page/Voyage_en_Islande');
  ok(!(await p.isVisible('.encadre a.nouveau:text("Islande")')) && await p.isVisible('.encadre a.wl:text("Islande")'), 'le lien rouge est devenu bleu');

  // 2. photo dans « Camille » (grande image → réduite)
  await p.goto(URL0 + '#/modifier/Camille');
  await p.waitForSelector('#texte');
  const png = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
    const g = c.getContext('2d'); const d = g.createImageData(3000, 2000); for (let i = 0; i < d.data.length; i += 4) { d.data[i] = (i * 13) % 255; d.data[i+1] = Math.random() * 255; d.data[i+2] = (i >> 9) % 255; d.data[i+3] = 255; } g.putImageData(d, 0, 0);
    const b = await new Promise(r => c.toBlob(r, 'image/png'));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  await p.setInputFiles('#fichiers', {name: 'Photo de Camille.png', mimeType: 'image/png', buffer: Buffer.from(png)});
  await p.waitForSelector('.photos-attente li');
  const txt = await p.inputValue('#texte');
  ok(txt.includes('![[Photo-de-Camille.jpg]]'), 'photo insérée sous un nom propre en .jpg : ' + txt.match(/!\[\[[^\]]+\]\]/));
  console.log('   taille après réduction :', await p.textContent('.photos-attente li'), '(original ' + Math.round(png.length/1024) + ' Ko)');
  await p.click('#publier');
  await p.waitForSelector('h1:text-is("Camille")');
  await p.waitForFunction(() => { const i = document.querySelector('.media.vignette img'); return i && i.naturalWidth > 0; });
  ok(await p.evaluate(() => document.querySelector('.media.vignette img').naturalWidth) === 2000, 'photo affichée, réduite à 2000 px');

  // 3. renommer Camille → Camille Martin (liens corrigés)
  await p.goto(URL0 + '#/renommer/Camille');
  await p.fill('input[name="titre"]', 'Camille Martin');
  ok(await p.isChecked('input[name="liens"]'), 'case « corriger les liens » cochée');
  await p.click('form button.principal');
  await p.waitForSelector('h1:text-is("Camille Martin")');
  await p.goto(URL0 + '#/page/Voyage_en_Islande');
  ok(await p.isVisible('.encadre a.wl:text("Camille Martin")') && await p.isVisible('.corps a.wl:text("Camille Martin")'), 'liens corrigés dans Voyage en Islande (encadré et texte)');
  await p.goto(URL0 + '#/page/Camille');
  ok(await p.isVisible('text=Cette page n’existe pas encore'), 'ancien titre libre');

  // 4. historique et différences
  await p.goto(URL0 + '#/historique/Voyage_en_Islande');
  await p.waitForSelector('.historique li');
  ok((await p.$$('.historique li')).length === 2, 'historique : 2 modifications');
  await p.click('.historique a:text("différences")');
  await p.waitForSelector('table.differences');
  const diff = await p.$$eval('table.differences tr.ajout td.ligne, table.differences tr.retrait td.ligne', l => l.map(x => x.textContent));
  ok(diff.some(l => l.includes('Camille Martin')), 'différences : ' + JSON.stringify(diff));
  // version ancienne + restaurer
  await p.goto(URL0 + '#/historique/Voyage_en_Islande');
  await p.waitForSelector('.historique li');
  await p.click('.historique li:last-child .date a');
  await p.waitForSelector('.bandeau-version');
  await p.click('#restaurer');
  await p.waitForSelector('#texte');
  ok((await p.inputValue('#texte')).includes('[[Camille]]') && await p.isVisible('text=chargée : publie pour la restaurer'), 'restaurer charge l’ancienne version dans l’éditeur');
  await p.click('#annuler');

  // 5. recherche avec faute
  await p.goto(URL0 + '#/recherche/islnde%20baignade');
  await p.waitForSelector('.resultats');
  const res = await p.$$eval('.titre-resultat', l => l.map(a => a.textContent));
  ok(res[0] === 'Voyage en Islande', 'recherche tolérante aux fautes : ' + JSON.stringify(res));
  ok(await p.isVisible('.extrait mark'), 'extrait avec mots surlignés');
  // suggestions de l'en-tête
  await p.fill('#recherche', 'isl');
  await p.waitForSelector('#suggestions:not([hidden]) li');
  const sug = await p.$$eval('#suggestions li', l => l.map(x => x.textContent.trim()));
  ok(sug[0] === 'Islande' && sug.includes('Voyage en Islande'), 'suggestions : ' + JSON.stringify(sug));
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter');
  await p.waitForSelector('h1:text-is("Islande")');
  ok(true, 'flèche + Entrée ouvre la suggestion');
  // alias
  await p.goto(URL0 + '#/page/Liste_des_voyages');
  ok(await p.isVisible('text=Redirigé depuis'), 'alias → redirection vers Voyages');

  // 6. pages spéciales
  await p.goto(URL0 + '#/special/demandees');
  const dem = await p.$$eval('.corps ol li > a', l => l.map(a => a.textContent));
  ok(dem.includes('Sam') && dem.includes('Page à écrire') && dem.includes('Week-end à Lisbonne') && !dem.includes('Aide'), 'pages demandées : ' + JSON.stringify(dem));
  await p.goto(URL0 + '#/special/recentes');
  await p.waitForSelector('.recentes li .pages a');
  ok((await p.$$('.recentes li')).length >= 4, 'modifications récentes');
  await p.goto(URL0 + '#/special/categories');
  ok(await p.isVisible('a:text("Voyages")'), 'catégories');
  await p.goto(URL0 + '#/categorie/Voyages');
  ok((await p.$$('.colonnes li')).length === 2, 'page de catégorie');

  // 7. brouillon
  await p.goto(URL0 + '#/modifier/Voyages');
  await p.waitForSelector('#texte');
  await p.click('#texte'); await p.keyboard.press('Control+End'); await p.keyboard.type('\n- Brouillon en cours');
  await p.waitForTimeout(600);
  await p.goto(URL0 + '#/page/Voyages');
  await p.goto(URL0 + '#/modifier/Voyages');
  await p.waitForSelector('#jeter-brouillon');
  ok((await p.inputValue('#texte')).includes('Brouillon en cours'), 'brouillon repris');
  await p.click('#jeter-brouillon');
  ok(!(await p.inputValue('#texte')).includes('Brouillon en cours'), 'brouillon abandonné');

  // 8. supprimer
  await p.goto(URL0 + '#/supprimer/Islande');
  await p.click('#confirmer');
  await p.waitForSelector('.toast.succes:text("supprimée")');
  await p.goto(URL0 + '#/page/Voyage_en_Islande');
  console.log('   encadré :', await p.$$eval('.encadre a', l => l.map(a => a.className + ':' + a.textContent)));
  ok(await p.isVisible('.encadre a.nouveau:text("Islande")'), 'après suppression, le lien redevient rouge');

  // 9. note de bas de page via le bouton
  await p.goto(URL0 + '#/modifier/Voyages');
  await p.waitForSelector('#texte');
  await p.click('#texte'); await p.keyboard.press('Control+Home');
  await p.click('[data-outil="note"]');
  await p.keyboard.type('Source de la note');
  ok(/\[\^1\][\s\S]*\n\[\^1\]: Source de la note$/.test(await p.inputValue('#texte')), 'bouton Note : appel + définition en bas');
  await p.click('#annuler');

  // 10. rechargement complet : tout revient du cache
  await p.reload();
  await p.waitForSelector('h1');
  await p.goto(URL0 + '#/page/Camille_Martin');
  await p.waitForFunction(() => { const i = document.querySelector('.media.vignette img'); return i && i.naturalWidth > 0; });
  ok(true, 'après rechargement, page et photo toujours là');

  // 11. téléphone : pas de défilement horizontal, menu
  await p.setViewportSize({width: 390, height: 844});
  for (const h of ['#/page/Voyage_en_Islande', '#/modifier/Voyages', '#/special/recentes', '#/reglages', '#/historique/Voyage_en_Islande']) {
    await p.goto(URL0 + h); await p.waitForTimeout(400);
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(w <= 390, `téléphone ${h} : largeur ${w}`);
  }
  await p.click('#bouton-menu'); await p.waitForTimeout(300);
  await p.click('#menu a:text("Toutes les pages")'); await p.waitForTimeout(300);
  ok(!(await p.evaluate(() => document.body.classList.contains('menu-ouvert'))), 'le menu se ferme après un choix');
  await p.goto(URL0 + '#/modifier/Voyages'); await p.waitForTimeout(300);

  console.log(erreurs.length ? 'ERREURS CONSOLE:\n' + erreurs.join('\n') : '✓ aucune erreur dans la console');
  await b.close();
})().catch(async e => { console.error(e.message); process.exit(1); });
