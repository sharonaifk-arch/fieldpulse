/**
 * Génère "Guide-Utilisateur-FieldPulse.pdf" — guide utilisateur complet,
 * coloré, structuré, avec captures RÉELLES de l'application.
 *
 * Pipeline (100% local, via Electron déjà installé) :
 *   1. démarre le serveur FieldPulse en mémoire (cache data/ existant)
 *   2. ouvre une fenêtre cachée, charge chaque écran, désactive les
 *      animations, capture la page en PNG
 *   3. assemble un document HTML riche (thème DashStack, police embarquée,
 *      captures intégrées en base64)
 *   4. Electron printToPDF → PDF fidèle (A4, couleurs, fonds)
 *
 * Lancement : npx electron scripts/gen-guide.mjs
 */
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PDF = path.join(ROOT, "Guide-Utilisateur-FieldPulse.pdf");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (p) => fs.readFileSync(p).toString("base64");

// police de marque embarquée (offline) — sinon printToPDF n'aurait pas Nunito
const FONT_DIR = path.join(ROOT, "node_modules/@fontsource/nunito-sans/files");
const fontFace = (weight) => {
  const f = path.join(FONT_DIR, `nunito-sans-latin-${weight}-normal.woff2`);
  return `@font-face{font-family:'Nunito Sans';font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${b64(f)}) format('woff2');}`;
};

/* ---- configuration serveur : réutilise le cache existant ---- */
process.env.FACM_PORT = "0";
process.env.FACM_HOST = "127.0.0.1";
process.env.FACM_OPEN_BROWSER = "0";
process.env.FACM_WEB_DIST = path.join(ROOT, "apps/web/dist");
process.env.FACM_DATA_DIR = path.join(ROOT, "data");

const CSS_FREEZE = `
*,*::before,*::after{animation:none !important;transition:none !important;}
.anim-item{opacity:1 !important;transform:none !important;}
`;

/** Charge une route (HashRouter), fige les animations, capture en PNG base64. */
async function capture(win, base, hash, { wait = 1400, light = true } = {}) {
  await win.loadURL(`${base}#${hash}`);
  await win.webContents.executeJavaScript(`
    localStorage.setItem('facm.theme','${light ? "light" : "dark"}');
    document.documentElement.classList.${light ? "remove" : "add"}('dark');
    (function(){var s=document.getElementById('__freeze');if(!s){s=document.createElement('style');s.id='__freeze';document.head.appendChild(s);}s.textContent=${JSON.stringify(CSS_FREEZE)};})();
    true;
  `);
  await sleep(wait);
  const img = await win.webContents.capturePage();
  return "data:image/png;base64," + img.toPNG().toString("base64");
}

async function main() {
  const serverEntry = path.join(ROOT, "apps/server/dist/main.js");
  const { startServer } = await import(pathToFileURL(serverEntry).href);
  const info = await startServer();
  const base = info.launchUrl; // http://127.0.0.1:PORT/?facmtoken=...

  // récupère un fileHash pour l'écran "Détail FA" (on prend le Recall France)
  let faHash = null;
  try {
    const res = await fetch(`${info.url}/api/runs/latest/results`, { headers: { "X-FACM-Token": info.token } });
    const data = await res.json();
    const pick = (data.results || []).find((r) => r.faType === "recall" && r.kpis.openResponses > 0) || (data.results || [])[0];
    faHash = pick?.fileHash ?? null;
  } catch {
    /* détail FA sera omis */
  }

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: { offscreen: false, sandbox: false },
  });

  const shots = {};
  shots.dashboard = await capture(win, base, "/");
  shots.sources = await capture(win, base, "/sources");
  shots.monitoring = await capture(win, base, "/monitoring");
  if (faHash) shots.detail = await capture(win, base, `/fa/${faHash}`, { wait: 1800 });
  shots.priorities = await capture(win, base, "/priority");
  shots.quality = await capture(win, base, "/quality");
  shots.exports = await capture(win, base, "/exports");
  shots.history = await capture(win, base, "/history");
  shots.settings = await capture(win, base, "/settings");

  const html = buildGuideHtml(shots);
  const tmpHtml = path.join(ROOT, "scripts", ".guide.tmp.html");
  fs.writeFileSync(tmpHtml, html, "utf8");
  await win.loadFile(tmpHtml);
  await sleep(600);

  const pdf = await win.webContents.printToPDF({
    pageSize: "A4",
    printBackground: true,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    preferCSSPageSize: true,
  });
  fs.writeFileSync(OUT_PDF, pdf);
  fs.rmSync(tmpHtml, { force: true });

  const mb = (fs.statSync(OUT_PDF).size / 1024 / 1024).toFixed(1);
  console.log(`\n✔ Guide généré : ${OUT_PDF} (${mb} Mo)`);
  app.quit();
  process.exit(0);
}

/* =======================================================================
   Contenu du guide (HTML riche, thème DashStack)
   ======================================================================= */
function buildGuideHtml(s) {
  const C = {
    indigo: "#3749A6", accent: "#4880FF", accentSoft: "#EAF0FF",
    bg: "#F5F6FA", ink: "#202224", muted: "#646B72", faint: "#9AA0A6",
    green: "#16A34A", greenSoft: "#E7F5EF", orange: "#EA580C", orangeSoft: "#FDEEE3",
    amber: "#B45309", amberSoft: "#F8EFDD", red: "#DC2626", redSoft: "#FCEAEA",
    line: "#E7EAF0", pulse: "#22C55E", white: "#FFFFFF",
  };

  const shot = (src, caption) =>
    src
      ? `<figure class="shot"><img src="${src}" alt="${caption}"/><figcaption>${caption}</figcaption></figure>`
      : "";

  const badge = (txt, bg, fg) =>
    `<span class="badge" style="background:${bg};color:${fg}">${txt}</span>`;

  const statusRow = (color, soft, name, desc) => `
    <tr>
      <td><span class="dot" style="background:${color}"></span><b>${name}</b></td>
      <td>${desc}</td>
    </tr>`;

  const step = (n, title, body) => `
    <div class="step">
      <div class="step-n">${n}</div>
      <div><div class="step-t">${title}</div><div class="step-b">${body}</div></div>
    </div>`;

  const section = (id, num, title, sub, body) => `
    <section${id ? ` id="${id}"` : ""}>
      <div class="sec-head"><span class="sec-num">${num}</span><div><h2>${title}</h2>${sub ? `<p class="sec-sub">${sub}</p>` : ""}</div></div>
      ${body}
    </section>`;

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<style>
${fontFace(400)}${fontFace(600)}${fontFace(700)}${fontFace(800)}
@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family:'Nunito Sans',system-ui,'Segoe UI',sans-serif; color:${C.ink}; font-size:11px; line-height:1.55; }
.page { width:210mm; min-height:297mm; padding:16mm 15mm; page-break-after:always; position:relative; background:${C.white}; }
.page:last-child { page-break-after:auto; }

/* --- cover --- */
.cover { background:linear-gradient(150deg,${C.indigo} 0%,#2b3a8a 55%,#1f2a66 100%); color:#fff; display:flex; flex-direction:column; justify-content:center; padding:30mm 22mm; }
.cover .logo { display:flex; align-items:center; gap:10px; margin-bottom:40px; }
.cover .logo-badge { width:46px; height:46px; border-radius:14px; background:rgba(255,255,255,.14); display:flex; align-items:center; justify-content:center; }
.cover .logo-txt { font-size:26px; font-weight:800; letter-spacing:-.5px; }
.cover h1 { font-size:44px; font-weight:800; line-height:1.05; letter-spacing:-1px; margin-bottom:14px; }
.cover .lead { font-size:15px; opacity:.85; max-width:130mm; margin-bottom:34px; }
.cover .meta { display:flex; gap:26px; font-size:12px; opacity:.8; border-top:1px solid rgba(255,255,255,.2); padding-top:18px; }
.cover .meta b { display:block; font-size:15px; opacity:1; font-weight:700; margin-top:3px; }
.cover .pill { position:absolute; top:30mm; right:22mm; background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.25); padding:6px 14px; border-radius:99px; font-size:11px; font-weight:700; }

/* --- toc --- */
.toc h2 { font-size:22px; font-weight:800; color:${C.indigo}; margin-bottom:18px; }
.toc ol { list-style:none; counter-reset:t; }
.toc li { counter-increment:t; display:flex; align-items:baseline; gap:12px; padding:9px 0; border-bottom:1px solid ${C.line}; font-size:12.5px; }
.toc li::before { content:counter(t,decimal-leading-zero); font-weight:800; color:${C.accent}; font-size:13px; width:26px; }
.toc li .d { flex:1; border-bottom:1px dotted ${C.line}; margin:0 8px; transform:translateY(-3px); }
.toc li b { font-weight:700; }

/* --- sections --- */
section { margin-bottom:20px; }
.sec-head { display:flex; gap:12px; align-items:flex-start; margin-bottom:12px; padding-bottom:10px; border-bottom:2px solid ${C.accentSoft}; }
.sec-num { flex-shrink:0; width:30px; height:30px; border-radius:9px; background:${C.accent}; color:#fff; font-weight:800; font-size:14px; display:flex; align-items:center; justify-content:center; }
.sec-head h2 { font-size:19px; font-weight:800; color:${C.ink}; letter-spacing:-.3px; }
.sec-sub { font-size:11.5px; color:${C.muted}; margin-top:2px; }
h3 { font-size:13px; font-weight:700; color:${C.indigo}; margin:14px 0 7px; }
p { margin-bottom:8px; }
.muted { color:${C.muted}; }

/* --- screenshots --- */
.shot { margin:12px 0 16px; border-radius:12px; overflow:hidden; border:1px solid ${C.line}; box-shadow:0 6px 20px rgba(20,30,60,.08); }
.shot img { width:100%; display:block; }
.shot figcaption { background:${C.bg}; color:${C.muted}; font-size:10px; font-weight:600; padding:7px 12px; border-top:1px solid ${C.line}; }

/* --- callouts --- */
.note { border-radius:10px; padding:11px 14px; margin:11px 0; font-size:11px; display:flex; gap:10px; }
.note b { font-weight:700; }
.note.tip { background:${C.greenSoft}; border-left:3px solid ${C.green}; }
.note.warn { background:${C.orangeSoft}; border-left:3px solid ${C.orange}; }
.note.info { background:${C.accentSoft}; border-left:3px solid ${C.accent}; }
.note.ico { font-weight:800; }

/* --- steps --- */
.step { display:flex; gap:12px; margin:9px 0; }
.step-n { flex-shrink:0; width:24px; height:24px; border-radius:50%; background:${C.indigo}; color:#fff; font-weight:800; font-size:12px; display:flex; align-items:center; justify-content:center; }
.step-t { font-weight:700; font-size:12px; }
.step-b { font-size:11px; color:${C.muted}; }

/* --- tables --- */
table { width:100%; border-collapse:collapse; margin:10px 0; font-size:11px; }
th { background:${C.indigo}; color:#fff; text-align:left; padding:8px 11px; font-weight:700; font-size:10.5px; }
td { padding:8px 11px; border-bottom:1px solid ${C.line}; vertical-align:top; }
tr:nth-child(even) td { background:${C.bg}; }
.dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:7px; vertical-align:middle; }
.badge { display:inline-block; padding:2px 9px; border-radius:99px; font-size:10px; font-weight:700; }

/* --- KPI legend cards --- */
.kpis { display:grid; grid-template-columns:1fr 1fr; gap:9px; margin:10px 0; }
.kpi { border:1px solid ${C.line}; border-radius:10px; padding:10px 12px; }
.kpi .t { font-weight:800; font-size:11.5px; }
.kpi .d { font-size:10.5px; color:${C.muted}; margin-top:2px; }

/* --- footer --- */
.foot { position:absolute; bottom:9mm; left:15mm; right:15mm; display:flex; justify-content:space-between; font-size:9px; color:${C.faint}; border-top:1px solid ${C.line}; padding-top:6px; }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
</style></head><body>

<!-- COVER -->
<div class="page cover">
  <div class="pill">Guide utilisateur · v1.0</div>
  <div class="logo"><div class="logo-badge">
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${C.pulse}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
  </div><span class="logo-txt">Field<span style="color:${C.pulse}">Pulse</span></span></div>
  <h1>Suivez vos Field Actions<br>en un coup d'œil.</h1>
  <p class="lead">FieldPulse centralise le suivi de clôture des Field Actions (Recall, Correction, Advisory) à partir de vos Customer Lists Excel — sans ouvrir un seul fichier à la main. 100 % local, 100 % hors-ligne.</p>
  <div class="meta">
    <div>Application<b>FieldPulse Desktop</b></div>
    <div>Usage<b>Interne · lecture seule</b></div>
    <div>Données<b>Restent sur votre poste</b></div>
  </div>
</div>

<!-- TOC -->
<div class="page toc">
  <h2>Sommaire</h2>
  <ol>
    <li><b>À quoi sert FieldPulse</b><span class="d"></span><span class="muted">3</span></li>
    <li><b>Installation</b><span class="d"></span><span class="muted">3</span></li>
    <li><b>L'interface en un coup d'œil</b><span class="d"></span><span class="muted">4</span></li>
    <li><b>Charger vos données (Sources)</b><span class="d"></span><span class="muted">4</span></li>
    <li><b>Le Dashboard</b><span class="d"></span><span class="muted">5</span></li>
    <li><b>Monitoring — la liste des FA</b><span class="d"></span><span class="muted">6</span></li>
    <li><b>Détail d'une Field Action</b><span class="d"></span><span class="muted">7</span></li>
    <li><b>Priorités</b><span class="d"></span><span class="muted">8</span></li>
    <li><b>Qualité des données</b><span class="d"></span><span class="muted">8</span></li>
    <li><b>Exports (Excel & PDF)</b><span class="d"></span><span class="muted">9</span></li>
    <li><b>Historique & Paramètres</b><span class="d"></span><span class="muted">9</span></li>
    <li><b>Comprendre les statuts de clôture</b><span class="d"></span><span class="muted">10</span></li>
    <li><b>Sécurité & confidentialité</b><span class="d"></span><span class="muted">11</span></li>
    <li><b>Questions fréquentes</b><span class="d"></span><span class="muted">11</span></li>
  </ol>
</div>

<!-- PAGE 3 : intro + install -->
<div class="page">
  ${section("", "1", "À quoi sert FieldPulse", "Le problème qu'il résout",
    `<p>Chaque Field Action génère un fichier Excel « Customer List » qui recense les clients concernés, les formulaires reçus (VF / Ackn. Form) et les quantités retournées. Suivre l'avancement de clôture obligeait à <b>ouvrir chaque fichier un par un</b>.</p>
     <p>FieldPulse lit ces fichiers automatiquement et répond en une seconde aux questions clés :</p>
     <div class="kpis">
       <div class="kpi"><div class="t">Quelles FA sont prêtes à clôturer&nbsp;?</div></div>
       <div class="kpi"><div class="t">Qui n'a pas renvoyé son formulaire&nbsp;?</div></div>
       <div class="kpi"><div class="t">Quelles quantités manquent&nbsp;?</div></div>
       <div class="kpi"><div class="t">Quelles FA ont dépassé le délai&nbsp;?</div></div>
     </div>
     <div class="note tip"><span class="ico">✓</span><div><b>Lecture seule garantie.</b> FieldPulse n'écrit jamais dans vos fichiers Excel. Il les lit, calcule, et affiche — c'est tout.</div></div>`)}

  ${section("", "2", "Installation", "Aucune compétence technique requise",
    `<p>Deux façons de lancer l'application, au choix :</p>
     ${step("A", "Installeur (recommandé)", "Double-cliquez <b>FieldPulse-Setup-1.0.0.exe</b> → choisissez le dossier → raccourcis Bureau et menu Démarrer créés automatiquement.")}
     ${step("B", "Version portable", "Copiez <b>FieldPulse-Portable-1.0.0.exe</b> où vous voulez (clé USB, dossier partagé) et double-cliquez. Aucune installation.")}
     <div class="note warn"><span class="ico">!</span><div><b>Premier lancement Windows.</b> SmartScreen peut afficher un avertissement (application non signée). Cliquez « <b>Informations complémentaires</b> » puis « <b>Exécuter quand même</b> ». C'est normal pour une app interne.</div></div>
     <p class="muted">L'app s'ouvre dans sa propre fenêtre. Vos données (cache, exports, commentaires) sont stockées dans <code>%APPDATA%\\FieldPulse</code>.</p>`)}
  <div class="foot"><span>FieldPulse — Guide utilisateur</span><span>3</span></div>
</div>

<!-- PAGE 4 : interface + sources -->
<div class="page">
  ${section("", "3", "L'interface en un coup d'œil", "Trois zones à connaître",
    `<div class="grid2">
      <div>
       ${step("1", "La barre latérale", "Navigation entre les écrans. Cliquez la flèche en bas pour la réduire en icônes. Les pastilles rouges/oranges signalent les vraies alertes.")}
       ${step("2", "L'en-tête", "Titre de l'écran, date de dernière analyse, bouton d'actualisation, langue (FR/EN) et thème clair/sombre.")}
       ${step("3", "Le contenu", "Cartes, tableaux et graphiques animés qui s'adaptent à vos données.")}
      </div>
      <div>
       <div class="note info"><span class="ico">i</span><div><b>Thème clair ou sombre&nbsp;:</b> cliquez l'icône lune/soleil en haut à droite. Votre choix est mémorisé.</div></div>
       <div class="note info"><span class="ico">FR</span><div><b>Français ou anglais&nbsp;:</b> bouton FR/EN, à côté du thème.</div></div>
      </div>
     </div>`)}

  ${section("", "4", "Charger vos données", "Écran « Sources » — 3 méthodes",
    `${shot(s.sources, "Écran Sources — upload, scan de dossier et favoris")}
     ${step("1", "Upload manuel", "Glissez-déposez un ou plusieurs fichiers .xlsx. Analyse immédiate.")}
     ${step("2", "Scan de dossier (le plus puissant)", "Collez le chemin d'un dossier Teams/OneDrive synchronisé. FieldPulse trouve tous les Customer Lists, même dans les sous-dossiers. « Options avancées » : filtrer par pays, mots-clés, taille.")}
     ${step("3", "Bibliothèque", "Sauvegardez vos dossiers favoris pour les recharger en un clic.")}
     <div class="note tip"><span class="ico">✓</span><div><b>Cache intelligent.</b> Un fichier déjà analysé et inchangé n'est pas relu (détection par empreinte). Relancer un scan est quasi instantané. Bouton « Forcer l'analyse complète » si besoin.</div></div>`)}
  <div class="foot"><span>FieldPulse — Guide utilisateur</span><span>4</span></div>
</div>

<!-- PAGE 5 : dashboard -->
<div class="page">
  ${section("", "5", "Le Dashboard", "Votre tableau de bord — tout comprendre en 10 secondes",
    `${shot(s.dashboard, "Dashboard — indicateurs clés, carte des pays, priorités")}
     <h3>Les indicateurs du haut</h3>
     <table>
       <tr><th>Indicateur</th><th>Ce qu'il vous dit</th></tr>
       <tr><td><b>Taux de clôture</b></td><td>Part des FA prêtes à clôturer sur le total (anneau animé).</td></tr>
       <tr><td><b>Taux de réponse</b></td><td>Formulaires reçus sur formulaires attendus.</td></tr>
       <tr><td><b>Réponses ouvertes</b></td><td>Clients qui n'ont pas encore répondu. La flèche indique l'évolution depuis la dernière analyse.</td></tr>
       <tr><td><b>Qté manquante</b></td><td>Unités qui restent à réceptionner.</td></tr>
       <tr><td><b>Critiques</b></td><td>FA dont le délai de notification est dépassé.</td></tr>
     </table>
     <div class="grid2">
       <div>${step("Carte", "Field Actions par pays", "Chaque pays est coloré selon son statut le plus urgent. Cliquez un pays pour filtrer le Monitoring dessus.")}</div>
       <div>${step("Priorité", "À traiter en priorité", "Les FA les plus urgentes avec l'action suggérée. Cliquez pour ouvrir le détail.")}</div>
     </div>`)}
  <div class="foot"><span>FieldPulse — Guide utilisateur</span><span>5</span></div>
</div>

<!-- PAGE 6 : monitoring -->
<div class="page">
  ${section("", "6", "Monitoring", "La liste complète et filtrable de vos Field Actions",
    `${shot(s.monitoring, "Monitoring — filtres rapides, dispositif, prochaine action")}
     <h3>Filtrer rapidement</h3>
     <p>Deux rangées de filtres cumulables : par <b>statut</b> (Toutes, Critiques, Waiting Forms/GFE, Waiting Reconciliation, Ready, Bloquées) et par <b>type</b> (Recall, Correction, Advisory). Le compteur de chaque filtre indique le nombre de FA.</p>
     <h3>Colonnes utiles</h3>
     <table>
       <tr><th>Colonne</th><th>Signification</th></tr>
       <tr><td><b>Dispositif</b></td><td>Le produit concerné, déduit du dossier ou de la description.</td></tr>
       <tr><td><b>Statut</b></td><td>Badge coloré de clôture (voir section 11).</td></tr>
       <tr><td><b>Prochaine action</b></td><td>Ce qu'il reste à faire, calculé automatiquement.</td></tr>
       <tr><td><b>Icône Excel</b></td><td>Ouvre le fichier source dans Excel pour le modifier.</td></tr>
     </table>
     <div class="note info"><span class="ico">i</span><div>Recherchez, triez chaque colonne, personnalisez les colonnes visibles et paginez. Cliquez une ligne pour ouvrir le détail complet.</div></div>`)}
  <div class="foot"><span>FieldPulse — Guide utilisateur</span><span>6</span></div>
</div>

<!-- PAGE 7 : detail FA -->
<div class="page">
  ${section("", "7", "Détail d'une Field Action", "Tout savoir sur une FA précise",
    `${shot(s.detail, "Détail FA — onglet Résumé : évolution, blocage, clients à traiter")}
     <p>L'onglet <b>Résumé</b> est décisionnel : en une lecture vous savez <b>où en est la FA</b>, <b>pourquoi</b> elle est bloquée et <b>quoi faire ensuite</b>.</p>
     <table>
       <tr><th>Onglet</th><th>Contenu</th></tr>
       <tr><td><b>Résumé</b></td><td>Courbes d'évolution (réponses, quantités, taux), raison du blocage, clients prioritaires.</td></tr>
       <tr><td><b>Clients (Sold To)</b></td><td>Un ligne par client, statut de réponse et quantités.</td></tr>
       <tr><td><b>Lignes</b></td><td>Le détail ligne par ligne du fichier (paginé).</td></tr>
       <tr><td><b>Qualité</b></td><td>Anomalies éventuelles du fichier.</td></tr>
       <tr><td><b>Suivi</b></td><td>Vos commentaires internes et un statut manuel (À relancer, En attente client, Escaladé…).</td></tr>
     </table>
     <div class="note tip"><span class="ico">✓</span><div><b>Ouvrir dans Excel</b> (bouton en haut à droite) ouvre le fichier source original pour le corriger. Au retour, relancez l'analyse pour rafraîchir.</div></div>`)}
  <div class="foot"><span>FieldPulse — Guide utilisateur</span><span>7</span></div>
</div>

<!-- PAGE 8 : priorities + quality -->
<div class="page">
  ${section("", "8", "Priorités", "Ce qui demande votre attention, regroupé",
    `${shot(s.priorities, "Priorités — critiques, en attente, résumé manager")}
     <p>Cet écran regroupe les FA critiques, celles en attente de formulaires et celles en attente de réconciliation. En bas, un <b>résumé prêt à copier-coller</b> pour votre manager, généré automatiquement.</p>`)}

  ${section("", "9", "Qualité des données", "Uniquement quand c'est nécessaire",
    `${shot(s.quality, "Qualité des données — anomalies actionnables")}
     <p class="muted">Cet écran ne montre que les <b>vraies anomalies</b> en langage clair (fichier illisible, valeur suspecte…). Les détails techniques de détection de colonnes restent masqués sauf en mode debug.</p>`)}
  <div class="foot"><span>FieldPulse — Guide utilisateur</span><span>8</span></div>
</div>

<!-- PAGE 9 : exports + history + settings -->
<div class="page">
  ${section("", "10", "Exports", "Des rapports lisibles hors de l'app",
    `${shot(s.exports, "Exports — Excel détaillé et rapport PDF visuel")}
     <div class="grid2">
       <div>${step("Excel", "Classeur détaillé", "KPIs globaux, vue Monitoring (lignes teintées par statut), lignes bloquantes, détail par FA.")}</div>
       <div>${step("PDF", "Rapport visuel", "Bandeau, cartes KPI colorées, barres de progression, priorités. Idéal pour un point d'avancement.")}</div>
     </div>
     <p class="muted">Option « vue filtrée uniquement » pour n'exporter que ce que vous voyez. Génération en arrière-plan : l'app ne se fige jamais.</p>`)}

  ${section("", "11", "Historique & Paramètres", "",
    `<div class="grid2">
      <div>${shot(s.history, "Historique des analyses")}</div>
      <div>${shot(s.settings, "Paramètres")}</div>
     </div>
     <p><b>Historique</b> : la liste des analyses passées et un comparatif (diff) avec la précédente. <b>Paramètres</b> : langue, thème, délai avant qu'une FA soit « critique », et gestion du cache.</p>`)}
  <div class="foot"><span>FieldPulse — Guide utilisateur</span><span>9</span></div>
</div>

<!-- PAGE 10 : statuses -->
<div class="page">
  ${section("", "12", "Comprendre les statuts de clôture", "Le cœur du suivi",
    `<p>Chaque Field Action passe par ces états, dans cet ordre logique :</p>
     <table>
       <tr><th>Statut</th><th>Signification &amp; action</th></tr>
       ${statusRow(C.orange, C.orangeSoft, "Waiting Forms/GFE", "Des clients n'ont pas renvoyé leur formulaire (VF / Ackn. Form). <b>Action :</b> relancer les clients.")}
       ${statusRow(C.amber, C.amberSoft, "Waiting Reconciliation", "Formulaires reçus, mais des quantités restent à réceptionner. <b>Action :</b> réconcilier le produit.")}
       ${statusRow(C.green, C.greenSoft, "Ready for Closure", "Formulaires complets et quantités réconciliées. <b>Action :</b> clôturer la FA.")}
       ${statusRow(C.red, C.redSoft, "Bloqué", "Le fichier n'a pas pu être analysé correctement. <b>Action :</b> vérifier le fichier source.")}
     </table>
     <h3>Les trois types de Field Action</h3>
     <p>${badge("Recall", C.accentSoft, C.accent)} et ${badge("Correction", C.accentSoft, C.accent)} suivent les retours/corrections de produit via la colonne <b>VF</b> et la réconciliation des quantités. ${badge("Advisory", C.accentSoft, C.accent)} suit uniquement l'accusé de réception (Ackn. Form), sans retour produit.</p>
     <div class="note info"><span class="ico">i</span><div><b>RGA manquant</b> est signalé mais ne bloque jamais une clôture à lui seul.</div></div>`)}
  <div class="foot"><span>FieldPulse — Guide utilisateur</span><span>10</span></div>
</div>

<!-- PAGE 11 : security + faq -->
<div class="page">
  ${section("", "13", "Sécurité & confidentialité", "Vos données restent chez vous",
    `<div class="kpis">
      <div class="kpi"><div class="t">100 % local</div><div class="d">Aucune connexion internet, aucune donnée envoyée à l'extérieur.</div></div>
      <div class="kpi"><div class="t">Lecture seule</div><div class="d">Les fichiers Excel sources ne sont jamais modifiés.</div></div>
      <div class="kpi"><div class="t">Accès protégé</div><div class="d">L'app se verrouille sur votre session ; aucun autre programme du poste ne peut lire les données.</div></div>
      <div class="kpi"><div class="t">Données isolées</div><div class="d">Cache et exports rangés dans votre profil utilisateur, jamais dans le dossier source.</div></div>
     </div>`)}

  ${section("", "14", "Questions fréquentes", "",
    `<h3>L'app a modifié mon fichier Excel ?</h3>
     <p class="muted">Non, jamais. FieldPulse ouvre les fichiers en lecture seule. La seule façon de modifier un fichier est le bouton « Ouvrir dans Excel », qui vous rend la main dans Excel.</p>
     <h3>Un mauvais dispositif s'affiche ?</h3>
     <p class="muted">Le nom du dispositif vient du sous-dossier qui contient le fichier (ou, à défaut, de la description produit). Rangez vos Customer Lists dans un sous-dossier au nom du dispositif pour un affichage exact.</p>
     <h3>Les courbes d'évolution sont plates ?</h3>
     <p class="muted">C'est normal tant qu'il n'y a qu'une analyse. Relancez une analyse à quelques jours d'intervalle : les tendances apparaîtront.</p>
     <h3>Windows m'avertit au lancement ?</h3>
     <p class="muted">SmartScreen le fait pour toute app non signée. « Informations complémentaires » → « Exécuter quand même ».</p>`)}
  <div class="foot"><span>FieldPulse — Guide utilisateur · v1.0</span><span>11</span></div>
</div>

</body></html>`;
}

main().catch((e) => {
  console.error("[guide] échec:", e);
  process.exit(1);
});
