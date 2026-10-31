const { chromium } = require('playwright');
const {FauxGitHub, blobSha} = require('./faux-github.cjs');

const URL0 = process.env.WIKI_URL || 'http://127.0.0.1:8765/';
const ok = (c, m) => { if (!c) throw new Error('ÉCHEC : ' + m); console.log('✓ ' + m); };

function remplir(gh) {
  const f = {
    'README.md': '# wiki-donnees\nContenu privé du WIKI\n',
    '.obsidian/app.json': '{}',
    'articles/Accueil.md': 'Bienvenue. Voir [[Voyage au Japon]] et [[Camille]].\n',
    'articles/Voyage au Japon.md': '---\ndate: Avril 2019\navec: "[[Camille]]"\nimage: kyoto.png\ncategories: [Voyages]\n---\nLe **voyage au Japon**[^1].\n\n![[kyoto.png|Le temple]]\n\n[^1]: Note.\n',
    'articles/Personnes/Camille.md': '---\ncategories: [Personnes]\n---\n**Camille** a fait le [[Voyage au Japon]].\n',
    'medias/kyoto.png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64'),
  };
  for (let i = 1; i <= 120; i++) f[`articles/Page ${String(i).padStart(3, '0')}.md`] = `---\ncategories: [Série]\n---\nTexte de la page ${i}. Lien vers [[Page ${String(i % 120 + 1).padStart(3, '0')}]].\n`;
  gh.commit(f, 'Initial commit', 'delife-fr');
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport: {width: 1280, height: 900}, serviceWorkers: 'block'});
  const gh = new FauxGitHub();
  remplir(gh);
  await gh.installer(ctx);
  const p = await ctx.newPage();
  const erreurs = [];
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erreurs.push(m.text()); });
  p.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
  p.on('dialog', d => d.accept());

  // A. connexion : mauvaise clé puis bonne clé
  await p.goto(URL0 + '#/reglages');
  await p.fill('input[name="jeton"]', 'mauvaise');
  await p.click('#connecter');
  await p.waitForSelector('.resultat-test.erreur');
  ok((await p.textContent('.resultat-test')).includes('Clé GitHub refusée'), 'mauvaise clé : message clair');
  await p.fill('input[name="depot"]', 'autre-depot');
  await p.fill('input[name="jeton"]', 'cle-de-test');
  await p.click('#connecter');
  await p.waitForSelector('.resultat-test.erreur');
  ok((await p.textContent('.resultat-test')).includes('Dépôt introuvable'), 'mauvais dépôt : message clair');
  await p.fill('input[name="depot"]', 'wiki-donnees');
  gh.vider();
  await p.click('#connecter');
  await p.waitForSelector('h1:text-is("Accueil")', {timeout: 20000});
  ok(true, 'connexion réussie, page d’accueil du dépôt affichée');
  await p.waitForFunction(() => document.querySelector('#statut')?.dataset.etat === 'ok');
  console.log('   demandes au premier chargement :', JSON.stringify(gh.journal));
  ok(gh.compter('graphql-textes') === 3 && gh.compter('rest-blob') === 0, `123 articles en ${gh.compter('graphql-textes')} demandes groupées (50 par demande)`);
  ok(gh.journal.length <= 6, `premier chargement complet en ${gh.journal.length} demandes à GitHub`);
  const nb = await p.evaluate(() => document.querySelectorAll('#contenu a.wl').length);
  ok(nb === 2, 'liens de l’accueil bleus (dont Camille dans un sous-dossier)');

  // B. réouverture : une seule petite demande
  gh.vider();
  await p.reload();
  await p.waitForSelector('h1:text-is("Accueil")');
  await p.waitForFunction(() => document.querySelector('#statut')?.dataset.etat === 'ok');
  ok(gh.journal.length === 1 && gh.journal[0] === 'graphql-tete', 'réouverture : 1 seule demande (' + gh.journal.join(',') + ')');
  await p.goto(URL0 + '#/special/pages');
  ok((await p.$$('.colonnes li')).length === 123, 'README et .obsidian ignorés : 123 pages');

  // C. photo privée affichée, puis gardée sur l'appareil
  gh.vider();
  await p.goto(URL0 + '#/page/Voyage_au_Japon');
  await p.waitForFunction(() => [...document.querySelectorAll('.media img')].every(i => i.naturalWidth > 0));
  ok(gh.compter('rest-blob') === 1, 'photo du dépôt privé téléchargée une fois (encadré + texte) : ' + gh.compter('rest-blob'));
  gh.vider(); await p.reload(); await p.waitForFunction(() => [...document.querySelectorAll('.media img')].length === 2 && [...document.querySelectorAll('.media img')].every(i => i.naturalWidth > 0));
  ok(gh.compter('rest-blob') === 0, 'après rechargement, photo reprise sur l’appareil sans téléchargement');

  // D. modifier + publier : 1 commit, rien à retélécharger ensuite
  gh.vider();
  await p.goto(URL0 + '#/modifier/Camille');
  await p.waitForSelector('#texte');
  await p.click('#texte'); await p.keyboard.press('Control+End'); await p.keyboard.type('\nElle aime le thé.');
  await p.fill('#resume', 'ajout du thé');
  await p.click('#publier');
  await p.waitForSelector('h1:text-is("Camille")');
  ok(gh.texte('articles/Personnes/Camille.md').endsWith('Elle aime le thé.'), 'texte enregistré dans le dépôt, au même endroit (sous-dossier)');
  ok(gh.commits.get(gh.tete).message === 'Camille : ajout du thé', 'message du commit = résumé');
  ok(gh.compter('graphql-commit') === 1, 'enregistrement en 1 demande GraphQL');
  gh.vider();
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await p.reload(); await p.waitForSelector('h1'); await p.waitForFunction(() => document.querySelector('#statut')?.dataset.etat === 'ok');
  ok(gh.journal.join(',') === 'graphql-tete', 'après publication : rien retéléchargé (empreintes calculées localement) — ' + gh.journal.join(','));

  // E. conflit : la page change ailleurs pendant l'écriture
  await p.goto(URL0 + '#/modifier/Camille');
  await p.waitForSelector('#texte');
  gh.commit({'articles/Personnes/Camille.md': gh.texte('articles/Personnes/Camille.md') + '\nAjout depuis le téléphone.'}, 'Modif téléphone');
  await p.click('#texte'); await p.keyboard.press('Control+End'); await p.keyboard.type('\nAjout depuis l’ordinateur.');
  await p.click('#publier');
  await p.waitForSelector('#ecraser');
  ok((await p.textContent('.texte-distant')).includes('Ajout depuis le téléphone'), 'conflit détecté, version en ligne montrée, rien écrasé');
  ok(!gh.texte('articles/Personnes/Camille.md').includes('ordinateur'), 'le dépôt n’a pas été écrasé');
  await p.click('#ecraser');
  await p.waitForSelector('h1:text-is("Camille")');
  ok(gh.texte('articles/Personnes/Camille.md').includes('ordinateur'), '« Publier quand même » enregistre mon texte');

  // F. une autre page a changé entre-temps : nouvel essai automatique
  await p.goto(URL0 + '#/modifier/Page_001');
  await p.waitForSelector('#texte');
  gh.commit({'articles/Page 050.md': 'Changée ailleurs.'}, 'autre appareil');
  await p.click('#texte'); await p.keyboard.press('Control+End'); await p.keyboard.type('\nSuite.');
  gh.vider();
  await p.click('#publier');
  await p.waitForSelector('h1:text-is("Page 001")');
  ok(gh.texte('articles/Page 001.md').endsWith('Suite.') && gh.texte('articles/Page 050.md') === 'Changée ailleurs.', 'autre page modifiée ailleurs : publication réussie sans rien perdre');

  // G. photo envoyée avec la page, dans le même commit
  await p.goto(URL0 + '#/modifier/Page_002');
  await p.waitForSelector('#texte');
  const png = await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 64; c.height = 48; c.getContext('2d').fillRect(0, 0, 30, 30);
    return Array.from(new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer())); });
  await p.setInputFiles('#fichiers', {name: 'plan.png', mimeType: 'image/png', buffer: Buffer.from(png)});
  await p.waitForSelector('.photos-attente li');
  gh.vider();
  await p.click('#publier');
  await p.waitForSelector('h1:text-is("Page 002")');
  ok(gh.compter('graphql-commit') === 1 && gh.dernierCommit.fichiers === 2, 'page + photo dans un seul commit');
  ok(gh.fichiers().get('medias/plan.png') === blobSha(Buffer.from(png)), 'photo stockée à l’octet près dans medias/');
  await p.waitForFunction(() => { const i = document.querySelector('.media img'); return i && i.naturalWidth === 64; });
  ok(gh.compter('rest-blob') === 0, 'photo affichée sans la retélécharger');

  // H. renommer : un commit avec toutes les pages corrigées
  gh.vider();
  await p.goto(URL0 + '#/renommer/Camille');
  await p.fill('input[name="titre"]', 'Camille Durand');
  await p.click('form button.principal');
  await p.waitForSelector('h1:text-is("Camille Durand")');
  ok(gh.fichiers().has('articles/Personnes/Camille Durand.md') && !gh.fichiers().has('articles/Personnes/Camille.md'), 'fichier renommé dans son sous-dossier');
  ok(gh.texte('articles/Accueil.md').includes('[[Camille Durand]]') && gh.texte('articles/Voyage au Japon.md').includes('"[[Camille Durand]]"'), 'liens corrigés (texte et bloc d’infos)');
  ok(gh.compter('graphql-commit') === 1 && gh.dernierCommit.fichiers === 4, 'renommage en 1 commit (nouveau, ancien supprimé, 2 pages corrigées)');

  // I. historique, différences, version (REST)
  await p.goto(URL0 + '#/historique/Page_001');
  await p.waitForSelector('.historique li');
  ok((await p.$$('.historique li')).length === 2, 'historique de Page 001');
  await p.click('.historique a:text("différences")');
  await p.waitForSelector('table.differences tr.ajout');
  ok((await p.textContent('table.differences tr.ajout')).includes('Suite.'), 'différences affichées');
  await p.goto(URL0 + '#/special/recentes');
  await p.waitForSelector('.recentes li .pages a');
  ok((await p.$$('.recentes li')).length >= 7, 'modifications récentes avec les pages touchées');

  // J. hors ligne : lecture depuis l'appareil, publication refusée proprement, brouillon gardé
  gh.horsLigne = true;
  await p.reload();
  await p.waitForSelector('#statut[data-etat="hors-ligne"]');
  await p.goto(URL0 + '#/page/Voyage_au_Japon');
  await p.waitForFunction(() => document.querySelector('.media img')?.naturalWidth > 0);
  ok(true, 'hors ligne : article et photo lisibles');
  await p.goto(URL0 + '#/modifier/Page_003');
  await p.waitForSelector('#texte');
  await p.click('#texte'); await p.keyboard.press('Control+End'); await p.keyboard.type('\nÉcrit dans le train.');
  await p.click('#publier');
  await p.waitForSelector('.etat-envoi .erreur');
  ok((await p.textContent('.etat-envoi')).includes('brouillon'), 'hors ligne : publication refusée, brouillon gardé');
  gh.horsLigne = false;
  await p.reload(); await p.waitForSelector('#jeter-brouillon');
  await p.click('#publier');
  await p.waitForSelector('h1:text-is("Page 003")');
  ok(gh.texte('articles/Page 003.md').includes('Écrit dans le train.'), 'de retour en ligne : le brouillon est publié');

  // K. GraphQL refusé : repli automatique sur REST (lecture et écriture)
  gh.graphqlInterdit = true;
  await p.evaluate(async () => { localStorage.removeItem('wiki.github.lecture'); localStorage.removeItem('wiki.github.ecriture');
    await new Promise(r => { const q = indexedDB.deleteDatabase('wiki'); q.onsuccess = q.onerror = q.onblocked = r; }); });
  gh.vider();
  await p.goto(URL0 + '#/');
  await p.reload();
  await p.waitForSelector('h1:text-is("Accueil")', {timeout: 30000});
  ok(gh.compter('rest-blob') >= 120, 'GraphQL refusé : lecture par REST (' + gh.compter('rest-blob') + ' demandes)');
  await p.goto(URL0 + '#/modifier/Page_004');
  await p.waitForSelector('#texte');
  await p.click('#texte'); await p.keyboard.press('Control+End'); await p.keyboard.type('\nPar REST.');
  gh.vider();
  await p.click('#publier');
  await p.waitForSelector('h1:text-is("Page 004")');
  ok(gh.texte('articles/Page 004.md').endsWith('Par REST.') && gh.compter('rest-ecriture') >= 4, 'écriture par l’API Git REST (' + gh.compter('rest-ecriture') + ' demandes)');
  // conflit en REST
  await p.goto(URL0 + '#/modifier/Page_004'); await p.waitForSelector('#texte');
  gh.commit({'articles/Page 004.md': 'Changée ailleurs (REST).'}, 'ailleurs');
  await p.click('#texte'); await p.keyboard.type('X');
  await p.click('#publier');
  await p.waitForSelector('#ecraser');
  ok(gh.texte('articles/Page 004.md') === 'Changée ailleurs (REST).', 'conflit détecté aussi en REST, rien écrasé');

  ok(gh.erreursSchema.length === 0, 'toutes les requêtes GraphQL envoyées sont conformes au schéma de GitHub' + (gh.erreursSchema.length ? JSON.stringify(gh.erreursSchema) : ''));
  ok(gh.inattendus.length === 0, 'aucune demande inattendue à GitHub ' + JSON.stringify(gh.inattendus));
  console.log(erreurs.length ? 'ERREURS CONSOLE:\n' + erreurs.join('\n') : '✓ aucune erreur dans la console');
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
