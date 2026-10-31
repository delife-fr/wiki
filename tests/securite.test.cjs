const { chromium } = require('playwright');
const {FauxGitHub} = require('./faux-github.cjs');
const URL0 = process.env.WIKI_URL || 'http://127.0.0.1:8765/';
const ok = (c, m) => { if (!c) throw new Error('ÉCHEC : ' + m); console.log('✓ ' + m); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({serviceWorkers: 'block'});
  const gh = new FauxGitHub();
  const piege = `---
nom: "<img src=x onerror=alert('infobox')>"
lien: "[clic](javascript:alert('yaml'))"
image: piege.svg
---
<script>alert('script')</script>
<img src=x onerror="alert('img')">
<a href="javascript:alert('lien')">lien</a> [md](javascript:alert('md'))
<iframe src="https://exemple.fr"></iframe>
<div style="position:fixed;inset:0">plein écran</div>
[[<img src=x onerror=alert('wikilien')>]]
![[piege.svg]]
<form action="https://exemple.fr"><input name="cle"></form>
<svg><script>alert('svg')</script></svg>
<math><mi xlink:href="javascript:alert('math')">x</mi></math>
`;
  gh.commit({'articles/Accueil.md': piege, 'medias/piege.svg': '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(\'svgfichier\')"><script>alert("svgfichier2")</script><rect width="10" height="10"/></svg>'}, 'piège');
  await gh.installer(ctx);
  const p = await ctx.newPage();
  const alertes = [];
  p.on('dialog', d => { alertes.push(d.message()); d.dismiss(); });
  await p.goto(URL0);
  await p.evaluate(() => localStorage.setItem('wiki.reglages', JSON.stringify({mode: 'github', proprietaire: 'delife-fr', depot: 'wiki-donnees', branche: 'main', jeton: 'cle-de-test', dossierArticles: 'articles', dossierMedias: 'medias'})));
  await p.reload();
  await p.waitForSelector('h1:text-is("Accueil")');
  await p.waitForTimeout(1500);
  // cliquer sur tous les liens du contenu (sans quitter la page)
  for (const a of await p.$$('#contenu .corps a')) { await a.click({force: true, noWaitAfter: true}).catch(() => {}); await p.goBack().catch(() => {}); }
  await p.goto(URL0 + '#/modifier/Accueil'); await p.waitForSelector('#texte');
  await p.click('[data-mode="apercu"]'); await p.waitForTimeout(1000);
  const dom = await p.evaluate(() => {
    const c = document.querySelector('#contenu');
    return {scripts: c.querySelectorAll('script').length, iframes: c.querySelectorAll('iframe, form, input:not(#resume):not(#fichiers)').length,
      on: [...c.querySelectorAll('*')].filter(e => [...e.attributes].some(a => a.name.startsWith('on'))).length,
      js: [...c.querySelectorAll('[href],[src],[xlink\\:href]')].filter(e => /javascript:/i.test(e.getAttribute('href') || e.getAttribute('src') || e.getAttribute('xlink:href') || '')).length,
      style: [...c.querySelectorAll('.apercu [style]')].length};
  });
  ok(alertes.length === 0, 'aucun code exécuté (alertes : ' + JSON.stringify(alertes) + ')');
  ok(dom.scripts === 0 && dom.iframes === 0 && dom.on === 0 && dom.js === 0, 'contenu nettoyé : ' + JSON.stringify(dom));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
