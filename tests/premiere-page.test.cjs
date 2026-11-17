/* Scénario « premier jour » : le dépôt de contenu ne contient encore qu'un README (comme un dépôt tout juste créé sur GitHub).
   On s'y connecte, on crée une première page qui utilise tout ce que le wiki sait faire (bloc d'infos, photo réduite et envoyée
   avec la page, sommaire, note de bas de page, catégorie, alias, lien rouge), puis on écrit la page liée, on cherche avec une
   faute de frappe, on modifie, on compare, on restaure, on supprime, et on rouvre l'appli. Contenu inventé. */
const { chromium } = require('playwright');
const {FauxGitHub} = require('./faux-github.cjs');

const URL0 = process.env.WIKI_URL || 'http://127.0.0.1:8765/';
const ok = (c, m) => { if (!c) throw new Error('ÉCHEC : ' + m); console.log('✓ ' + m); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport: {width: 1280, height: 900}, serviceWorkers: 'block'});
  const gh = new FauxGitHub();
  gh.commit({'README.md': '# wiki-donnees\n'}, 'Initial commit', 'delife-fr');
  await gh.installer(ctx);
  const p = await ctx.newPage();
  const erreurs = [];
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erreurs.push(m.text()); });
  p.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
  p.on('dialog', d => d.accept());
  const publier = async titre => { await p.click('#publier'); await p.waitForSelector(`h1:text-is("${titre}")`, {timeout: 20000}); };

  // A. connexion à un dépôt qui ne contient qu'un README
  await p.goto(URL0 + '#/reglages');
  await p.fill('input[name="jeton"]', 'cle-de-test');
  await p.click('#connecter');
  await p.waitForSelector('h1:text-is("Bienvenue sur ton wiki")', {timeout: 20000});
  await p.waitForFunction(() => document.querySelector('#statut')?.dataset.etat === 'ok');
  ok((await p.textContent('#contenu')).includes('Le wiki est encore vide.'), 'dépôt avec seulement un README : connexion réussie, wiki vide, sans erreur');

  // B. première page, par « Nouvelle page »
  await p.goto(URL0 + '#/special/nouvelle');
  await p.fill('#form-nouvelle input[name="titre"]', 'Voiture');
  await p.click('#form-nouvelle button.principal');
  await p.waitForSelector('#texte');
  ok((await p.inputValue('#texte')).includes('categories:'), 'éditeur ouvert avec le modèle (bloc d’infos prêt)');
  // une vraie photo de téléphone : 2 400 × 1 600, plusieurs Mo ; elle doit être réduite avant l'envoi
  const grande = await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 2400; c.height = 1600; const x = c.getContext('2d');
    const im = x.createImageData(2400, 1600); for (let i = 0; i < im.data.length; i++) im.data[i] = (i % 4 === 3) ? 255 : Math.random() * 256; x.putImageData(im, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95));
    return await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result.split(',')[1]); f.readAsDataURL(blob); }); });
  const octets = Buffer.from(grande, 'base64');
  await p.fill('#texte', '');
  await p.setInputFiles('#fichiers', {name: 'Photo voiture.jpg', mimeType: 'image/jpeg', buffer: octets});
  await p.waitForSelector('.photos-attente li');
  const nomPhoto = (await p.inputValue('#texte')).match(/!\[\[([^\]]+)\]\]/)[1];
  ok(nomPhoto === 'Photo-voiture.jpg', 'photo ajoutée dans le texte, nom nettoyé (' + nomPhoto + ', ' + (octets.length / 1e6).toFixed(1) + ' Mo au départ)');
  const texte = `---
categories: [Véhicules]
aliases: [Bagnole]
image: ${nomPhoto}
legende: Devant la maison
modele: Citadine essence
garage: "[[Garage du coin]]"
---
La **voiture** sert tous les jours[^1].

## Entretien
Révision tous les 15 000 km, voir [[Carnet d’entretien]].

## Assurance
Contrat annuel, voir [[Carnet d’entretien|le carnet]].

### Échéance
En mars.

![[${nomPhoto}|Au garage|250]]

[^1]: Sauf le week-end.
`;
  await p.fill('#texte', texte);
  await p.fill('#resume', 'première page');
  gh.vider();
  await publier('Voiture');
  ok(gh.texte('articles/Voiture.md') === texte, 'page enregistrée dans articles/Voiture.md, texte exact (format Obsidian)');
  ok(gh.compter('graphql-commit') === 1 && gh.dernierCommit.fichiers === 2, 'page + photo dans un seul commit');
  ok(gh.commits.get(gh.tete).message === 'Voiture : première page', 'message du commit = titre et résumé');
  const dims = await p.evaluate(async b64 => { const i = new Image(); i.src = 'data:image/jpeg;base64,' + b64; await i.decode(); return [i.naturalWidth, i.naturalHeight]; },
    gh.blobs.get(gh.fichiers().get('medias/' + nomPhoto)).toString('base64'));
  const envoyee = gh.blobs.get(gh.fichiers().get('medias/' + nomPhoto)).length;
  ok(dims[0] === 2000 && dims[1] === 1333 && envoyee < octets.length, 'photo réduite avant l’envoi : ' + dims.join(' × ') + ' px, ' + (envoyee / 1e6).toFixed(1) + ' Mo');

  // C. tout ce que la page affiche
  await p.waitForFunction(() => [...document.querySelectorAll('.media img')].length === 2 && [...document.querySelectorAll('.media img')].every(i => i.naturalWidth > 0));
  const vu = await p.evaluate(() => ({
    encadre: document.querySelector('aside.encadre')?.textContent.replace(/\s+/g, ' ') || '',
    sommaire: [...document.querySelectorAll('nav.sommaire li')].map(l => l.textContent.trim()),
    notes: document.querySelector('.footnotes, section[data-footnotes], .notes')?.textContent || '',
    categories: [...document.querySelectorAll('.categories a.puce')].map(a => a.textContent.trim()),
    rouges: [...document.querySelectorAll('#contenu a.wl.nouveau')].map(a => a.textContent.trim()),
    gras: document.querySelector('#contenu strong')?.textContent || ''
  }));
  ok(vu.encadre.includes('Devant la maison') && vu.encadre.includes('Citadine essence') && vu.encadre.includes('Garage du coin'), 'bloc d’infos : photo, légende, champs libres');
  ok(vu.sommaire.length === 3 && vu.sommaire.join('|').includes('Échéance'), 'sommaire de 3 titres (' + vu.sommaire.join(', ') + ')');
  ok(vu.notes.includes('Sauf le week-end'), 'note de bas de page');
  ok(vu.categories.join() === 'Véhicules', 'catégorie affichée');
  ok(vu.rouges.includes('Carnet d’entretien') && vu.rouges.includes('le carnet') && vu.rouges.includes('Garage du coin'), 'liens rouges vers les pages à écrire (dont un lien renommé « le carnet »)');
  ok(vu.gras === 'voiture', 'mise en forme Markdown (gras)');

  // D. un lien rouge → la page liée ; [[Bagnole]] (alias) mène à Voiture
  await p.click('#contenu a.wl.nouveau:text-is("Carnet d’entretien")');
  await p.waitForSelector('#texte');
  await p.fill('#texte', 'Pleins et révisions de la [[Bagnole]].\n');
  await publier('Carnet d’entretien');
  ok(gh.fichiers().has('articles/Carnet d’entretien.md'), 'page liée créée depuis le lien rouge');
  ok(await p.getAttribute('#contenu a.wl', 'data-titre') === 'Voiture', 'alias : [[Bagnole]] mène à « Voiture »');
  await p.click('#contenu a.wl');
  await p.waitForSelector('h1:text-is("Voiture")');
  ok(!(await p.$$eval('#contenu a.wl.nouveau', l => l.map(a => a.textContent))).includes('Carnet d’entretien'), 'le lien est devenu bleu');
  ok((await p.textContent('details.liees')).includes('Carnet d’entretien'), '« Pages qui mènent ici » sur la première page');

  // E. catégorie, recherche avec faute de frappe, accueil
  await p.goto(URL0 + '#/categorie/V%C3%A9hicules');
  await p.waitForSelector('#contenu a[href*="Voiture"]');
  ok(true, 'page de la catégorie « Véhicules » avec la page');
  await p.goto(URL0 + '#/recherche/revisoin');
  await p.waitForSelector('#contenu a[href*="Voiture"], #contenu a[href*="Carnet"]', {timeout: 10000});
  ok(true, 'recherche plein texte qui tolère une faute de frappe (« revisoin »)');
  await p.goto(URL0 + '#/');
  await p.waitForSelector('#contenu a[href*="Voiture"]');
  ok((await p.textContent('#contenu')).includes('2 pages'), 'accueil : le wiki compte 2 pages');

  // F. modifier, historique, différences, restauration
  await p.goto(URL0 + '#/modifier/Voiture');
  await p.waitForSelector('#texte');
  await p.click('#texte'); await p.keyboard.press('Control+End'); await p.keyboard.type('Vendue en 2030.');
  await publier('Voiture');
  await p.goto(URL0 + '#/historique/Voiture');
  await p.waitForSelector('.historique li');
  ok((await p.$$('.historique li')).length === 2, 'historique : 2 versions');
  await p.click('.historique a:text("différences")');
  await p.waitForSelector('table.differences tr.ajout');
  ok((await p.textContent('table.differences')).includes('Vendue en 2030.'), 'différences entre les deux versions');
  await p.goto(URL0 + '#/historique/Voiture');
  await p.waitForSelector('.historique li');
  await p.click('.historique li:last-child .date a');
  await p.waitForSelector('#restaurer');
  await p.click('#restaurer');
  await p.waitForSelector('#texte');
  ok(!(await p.inputValue('#texte')).includes('Vendue'), 'ancienne version chargée dans l’éditeur');
  await publier('Voiture');
  ok(gh.texte('articles/Voiture.md') === texte, 'ancienne version restaurée dans le dépôt');

  // G. supprimer une page
  await p.goto(URL0 + '#/modifier/Brouillon');
  await p.waitForSelector('#texte');
  await p.fill('#texte', 'À jeter.');
  await publier('Brouillon');
  await p.goto(URL0 + '#/supprimer/Brouillon');
  await p.click('#confirmer');
  await p.waitForSelector('h1:text-is("Bienvenue sur ton wiki")');
  ok(!gh.fichiers().has('articles/Brouillon.md'), 'page supprimée du dépôt');

  // H. réouverture : tout vient de l'appareil
  gh.vider();
  await p.reload();
  await p.waitForSelector('h1');
  await p.waitForFunction(() => document.querySelector('#statut')?.dataset.etat === 'ok');
  ok(gh.journal.join(',') === 'graphql-tete', 'réouverture : une seule petite demande à GitHub (' + gh.journal.join(',') + ')');
  ok(gh.erreursSchema.length === 0, 'toutes les requêtes GraphQL conformes au schéma de GitHub' + (gh.erreursSchema.length ? JSON.stringify(gh.erreursSchema) : ''));
  ok(gh.inattendus.length === 0, 'aucune demande inattendue à GitHub ' + JSON.stringify(gh.inattendus));
  ok(!erreurs.length, 'aucune erreur dans la console' + (erreurs.length ? ' :\n' + erreurs.join('\n') : ''));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
