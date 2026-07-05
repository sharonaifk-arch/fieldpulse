/**
 * Generates "FieldPulse-User-Guide.pdf" — a clean, colorful, well-structured
 * user guide with REAL screenshots of the app.
 *
 * Pipeline (fully local, via the already-installed Electron):
 *   1. start the FieldPulse server in-process (reuse existing data/ cache)
 *   2. open a window, load each screen, freeze animations, capture a PNG
 *   3. assemble a flowing HTML document (DashStack theme, embedded font,
 *      screenshots inlined as base64)
 *   4. Electron printToPDF -> faithful PDF (A4, colors, backgrounds)
 *
 * Run: npm run guide   (i.e. electron scripts/gen-guide.mjs)
 *
 * NOTE: capturePage() only paints a VISIBLE window on Windows, so the window
 * is shown inactive (no focus stealing) rather than hidden — a hidden window
 * yields blank captures.
 */
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PDF = path.join(ROOT, "FieldPulse-User-Guide.pdf");
// intermediates in OS temp — the working dir is under OneDrive, which locks
// files mid-write and breaks rmSync/writeFile.
const WORK = path.join(os.tmpdir(), "fieldpulse-guide");
const SHOTS_DIR = path.join(WORK, "shots");
const SHOT_W = 1440;
const SHOT_H = 900;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (p) => fs.readFileSync(p).toString("base64");

// brand font embedded so printToPDF has Nunito Sans offline
const FONT_DIR = path.join(ROOT, "node_modules/@fontsource/nunito-sans/files");
const fontFace = (weight) =>
  `@font-face{font-family:'Nunito Sans';font-weight:${weight};font-display:block;` +
  `src:url(data:font/woff2;base64,${b64(path.join(FONT_DIR, `nunito-sans-latin-${weight}-normal.woff2`))}) format('woff2');}`;

process.env.FACM_PORT = "0";
process.env.FACM_HOST = "127.0.0.1";
process.env.FACM_OPEN_BROWSER = "0";
process.env.FACM_WEB_DIST = path.join(ROOT, "apps/web/dist");
process.env.FACM_DATA_DIR = path.join(ROOT, "data");

const FREEZE_CSS = `*,*::before,*::after{animation:none!important;transition:none!important}.anim-item{opacity:1!important;transform:none!important}`;

/** capturePage occasionally throws a transient UnknownVizError between GPU
 *  frames — retry a few times before giving up. */
async function capturePng(win, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      return (await win.webContents.capturePage()).toPNG();
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(500);
    }
  }
}

/** Load a HashRouter route, freeze animations, capture PNG to disk.
 *  Language/theme come from localStorage primed once before the loop. */
async function capture(win, base, name, hash, waitMs) {
  await win.loadURL(`${base}#${hash}`);
  await win.webContents.executeJavaScript(
    `(function(){var s=document.getElementById('__freeze')||document.head.appendChild(Object.assign(document.createElement('style'),{id:'__freeze'}));s.textContent=${JSON.stringify(FREEZE_CSS)};})();true;`
  );
  await sleep(waitMs);
  const png = await capturePng(win);
  fs.writeFileSync(path.join(SHOTS_DIR, `${name}.png`), png);
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function main() {
  fs.rmSync(SHOTS_DIR, { recursive: true, force: true });
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  const { startServer } = await import(pathToFileURL(path.join(ROOT, "apps/server/dist/main.js")).href);
  const info = await startServer();

  // pick a populated Recall FA for the detail screenshot
  let faHash = null;
  try {
    const res = await fetch(`${info.url}/api/runs/latest/results`, { headers: { "X-FACM-Token": info.token } });
    const { results = [] } = await res.json();
    faHash = (results.find((r) => r.faType === "recall" && r.kpis.openResponses > 0) || results[0])?.fileHash ?? null;
  } catch {
    /* detail screen skipped */
  }

  const win = new BrowserWindow({
    width: SHOT_W,
    height: SHOT_H,
    show: false,
    webPreferences: { sandbox: false, backgroundThrottling: false },
  });
  win.showInactive(); // visible (required for capturePage) but never steals focus

  // prime language + theme once — the app reads these from localStorage at
  // mount, so every subsequent route renders in English / light for the guide.
  await win.loadURL(info.launchUrl);
  await win.webContents.executeJavaScript(
    `localStorage.setItem('facm.lang','en');localStorage.setItem('facm.theme','light');true;`
  );

  const screens = [
    ["dashboard", "/", 2200],
    ["sources", "/sources", 1200],
    ["monitoring", "/monitoring", 1400],
    ...(faHash ? [["detail", `/fa/${faHash}`, 1800]] : []),
    ["priorities", "/priority", 1300],
    ["quality", "/quality", 1200],
    ["exports", "/exports", 1200],
    ["history", "/history", 1300],
    ["settings", "/settings", 1200],
  ];
  const shots = {};
  for (const [name, hash, wait] of screens) shots[name] = await capture(win, info.launchUrl, name, hash, wait);

  const tmpHtml = path.join(WORK, "guide.html");
  fs.writeFileSync(tmpHtml, buildHtml(shots), "utf8");
  await win.loadFile(tmpHtml);
  await sleep(700);

  const pdf = await win.webContents.printToPDF({
    pageSize: "A4",
    printBackground: true,
    preferCSSPageSize: true,
  });
  fs.writeFileSync(OUT_PDF, pdf);

  console.log(`\n✔ Guide: ${OUT_PDF} (${(fs.statSync(OUT_PDF).size / 1024 / 1024).toFixed(1)} MB)`);
  app.quit();
  process.exit(0);
}

/* ======================= guide document (English) ======================= */
function buildHtml(s) {
  const C = {
    indigo: "#3749A6", accent: "#4880FF", accentSoft: "#EAF0FF", bg: "#F5F6FA",
    ink: "#202224", muted: "#646B72", faint: "#9AA0A6", line: "#E7EAF0",
    green: "#16A34A", greenSoft: "#E7F5EF", orange: "#EA580C", orangeSoft: "#FDEEE3",
    amber: "#B45309", amberSoft: "#F8EFDD", red: "#DC2626", redSoft: "#FCEAEA", pulse: "#22C55E",
  };

  const shot = (src, cap) =>
    src ? `<figure class="shot"><img src="${src}"><figcaption>${cap}</figcaption></figure>` : "";
  const note = (kind, ico, html) => `<div class="note ${kind}"><span class="ico">${ico}</span><div>${html}</div></div>`;
  const step = (n, t, b) => `<div class="step"><div class="n">${n}</div><div><b>${t}</b><div class="sb">${b}</div></div></div>`;
  const status = (color, name, desc) =>
    `<tr><td><span class="dot" style="background:${color}"></span><b>${name}</b></td><td>${desc}</td></tr>`;
  const sec = (num, title, body) =>
    `<section><div class="sh"><span class="sn">${num}</span><h2>${title}</h2></div>${body}</section>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
${fontFace(400)}${fontFace(600)}${fontFace(700)}${fontFace(800)}
@page{size:A4;margin:15mm 14mm}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:'Nunito Sans',system-ui,'Segoe UI',sans-serif;color:${C.ink};font-size:11px;line-height:1.55}
h2{font-size:17px;font-weight:800;letter-spacing:-.3px}
h3{font-size:12.5px;font-weight:700;color:${C.indigo};margin:12px 0 6px}
p{margin-bottom:7px}.muted{color:${C.muted}}
code{background:${C.bg};padding:1px 5px;border-radius:4px;font-size:10px}

/* cover — first page, full colored card */
.cover{background:linear-gradient(150deg,${C.indigo},#2b3a8a 55%,#1f2a66);color:#fff;border-radius:16px;padding:26mm 18mm;min-height:255mm;display:flex;flex-direction:column;justify-content:center;break-after:page;position:relative}
.cover .pill{position:absolute;top:16mm;right:16mm;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);padding:6px 14px;border-radius:99px;font-size:11px;font-weight:700}
.logo{display:flex;align-items:center;gap:10px;margin-bottom:38px}
.logo .lb{width:44px;height:44px;border-radius:13px;background:rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center}
.logo .lt{font-size:25px;font-weight:800;letter-spacing:-.5px}
.cover h1{font-size:42px;font-weight:800;line-height:1.06;letter-spacing:-1px;margin-bottom:14px}
.cover .lead{font-size:15px;opacity:.85;max-width:135mm;margin-bottom:32px}
.cover .meta{display:flex;gap:28px;font-size:11px;opacity:.8;border-top:1px solid rgba(255,255,255,.2);padding-top:16px}
.cover .meta b{display:block;font-size:14px;opacity:1;margin-top:3px}

/* toc */
.toc h2{color:${C.indigo};margin-bottom:14px}
.toc ul{list-style:none;columns:2;column-gap:22px}
.toc li{display:flex;gap:9px;align-items:baseline;padding:7px 0;font-size:11.5px;break-inside:avoid}
.toc .k{font-weight:800;color:${C.accent};font-size:12px;width:20px}

/* sections flow naturally; keep each whole when it fits */
section{break-inside:avoid;margin-bottom:16px}
.sh{display:flex;gap:10px;align-items:center;margin-bottom:9px;padding-bottom:8px;border-bottom:2px solid ${C.accentSoft}}
.sn{width:28px;height:28px;border-radius:8px;background:${C.accent};color:#fff;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0}

.shot{margin:10px 0 14px;border-radius:11px;overflow:hidden;border:1px solid ${C.line};box-shadow:0 6px 18px rgba(20,30,60,.09);break-inside:avoid}
.shot img{width:100%;display:block}
.shot figcaption{background:${C.bg};color:${C.muted};font-size:10px;font-weight:600;padding:6px 11px;border-top:1px solid ${C.line}}

.note{border-radius:9px;padding:10px 13px;margin:9px 0;font-size:11px;display:flex;gap:9px;break-inside:avoid}
.note .ico{font-weight:800;flex-shrink:0}
.note.tip{background:${C.greenSoft};border-left:3px solid ${C.green}}.note.tip .ico{color:${C.green}}
.note.warn{background:${C.orangeSoft};border-left:3px solid ${C.orange}}.note.warn .ico{color:${C.orange}}
.note.info{background:${C.accentSoft};border-left:3px solid ${C.accent}}.note.info .ico{color:${C.accent}}

.step{display:flex;gap:10px;margin:8px 0;break-inside:avoid}
.step .n{width:23px;height:23px;border-radius:50%;background:${C.indigo};color:#fff;font-weight:800;font-size:11px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.step .sb{font-size:10.5px;color:${C.muted}}

table{width:100%;border-collapse:collapse;margin:9px 0;font-size:11px}
th{background:${C.indigo};color:#fff;text-align:left;padding:7px 10px;font-weight:700;font-size:10.5px}
td{padding:7px 10px;border-bottom:1px solid ${C.line};vertical-align:top}
tr:nth-child(even) td{background:${C.bg}}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;vertical-align:middle}

.cards{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:9px 0}
.card{border:1px solid ${C.line};border-radius:10px;padding:9px 11px;break-inside:avoid}
.card b{font-size:11.5px}.card .d{font-size:10.5px;color:${C.muted};margin-top:2px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:13px}
</style></head><body>

<div class="cover">
  <div class="pill">User Guide · v1.0</div>
  <div class="logo"><div class="lb">
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${C.pulse}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
  </div><span class="lt">Field<span style="color:${C.pulse}">Pulse</span></span></div>
  <h1>Track your Field Actions<br>at a glance.</h1>
  <p class="lead">FieldPulse reads your Excel Customer Lists and shows, in one screen, which Field Actions (Recall, Correction, Advisory) are ready to close, who hasn't replied, and what's overdue — without opening a single file by hand. Fully local, fully offline.</p>
  <div class="meta">
    <div>Application<b>FieldPulse Desktop</b></div>
    <div>Use<b>Internal · read-only</b></div>
    <div>Data<b>Stays on your PC</b></div>
  </div>
</div>

<div class="toc">
  <h2>Contents</h2>
  <ul>
    <li><span class="k">1</span><span>What FieldPulse does</span></li>
    <li><span class="k">2</span><span>Install</span></li>
    <li><span class="k">3</span><span>The interface</span></li>
    <li><span class="k">4</span><span>Load your data (Sources)</span></li>
    <li><span class="k">5</span><span>The Dashboard</span></li>
    <li><span class="k">6</span><span>Monitoring</span></li>
    <li><span class="k">7</span><span>Field Action detail</span></li>
    <li><span class="k">8</span><span>Priorities</span></li>
    <li><span class="k">9</span><span>Data quality</span></li>
    <li><span class="k">10</span><span>Exports</span></li>
    <li><span class="k">11</span><span>History &amp; Settings</span></li>
    <li><span class="k">12</span><span>Closure statuses</span></li>
    <li><span class="k">13</span><span>Security &amp; privacy</span></li>
    <li><span class="k">14</span><span>FAQ</span></li>
  </ul>
</div>

${sec("1", "What FieldPulse does",
  `<p>Every Field Action produces an Excel "Customer List": which customers are affected, which forms came back (VF / Ackn. Form), and which quantities were returned. Tracking closure used to mean opening each file one by one.</p>
   <p>FieldPulse reads them all automatically and answers the key questions instantly:</p>
   <div class="cards">
     <div class="card"><b>Which FAs are ready to close?</b></div>
     <div class="card"><b>Who hasn't returned their form?</b></div>
     <div class="card"><b>Which quantities are still missing?</b></div>
     <div class="card"><b>Which FAs are overdue?</b></div>
   </div>
   ${note("tip", "✓", "<b>Read-only, guaranteed.</b> FieldPulse never writes to your Excel files. It reads, computes, and displays — nothing else.")}`)}

${sec("2", "Install",
  `<p>Two ways to run the app — pick either:</p>
   ${step("A", "Installer (recommended)", "Double-click <b>FieldPulse-Setup-1.0.0.exe</b>, pick a folder — Desktop and Start-menu shortcuts are created for you.")}
   ${step("B", "Portable", "Copy <b>FieldPulse-Portable-1.0.0.exe</b> anywhere (USB stick, shared folder) and double-click. No install.")}
   ${note("warn", "!", "<b>First Windows launch.</b> SmartScreen may warn (app not signed). Click <b>More info</b> then <b>Run anyway</b> — normal for an internal app.")}
   <p class="muted">Your data (cache, exports, notes) lives in <code>%APPDATA%\\FieldPulse</code>.</p>`)}

${sec("3", "The interface",
  `<div class="grid2"><div>
     ${step("1", "Sidebar", "Move between screens. Click the arrow at the bottom to collapse it to icons. Red/orange dots flag real alerts only.")}
     ${step("2", "Header", "Screen title, last-analysis date, refresh button, language (EN/FR) and light/dark theme.")}
     ${step("3", "Content", "Animated cards, tables and charts that adapt to your data.")}
   </div><div>
     ${note("info", "◐", "<b>Light or dark:</b> the sun/moon icon, top right. Your choice is remembered.")}
     ${note("info", "EN", "<b>English or French:</b> the EN/FR button, next to the theme.")}
   </div></div>`)}

${sec("4", "Load your data",
  `<p class="muted">Screen "Sources" — three ways to bring in Customer Lists.</p>
   ${shot(s.sources, "Sources — upload, folder scan and favorites")}
   ${step("1", "Manual upload", "Drag &amp; drop one or more .xlsx files. Analyzed immediately.")}
   ${step("2", "Folder scan (most powerful)", "Paste the path of a synced Teams/OneDrive folder. FieldPulse finds every Customer List, sub-folders included. Advanced options filter by country, keyword, size.")}
   ${step("3", "Library", "Save favorite folders to reload them in one click.")}
   ${note("tip", "✓", "<b>Smart cache.</b> A file already analyzed and unchanged is not re-read (content fingerprint). Re-scanning is near-instant. Use \"Force full analysis\" when needed.")}`)}

${sec("5", "The Dashboard",
  `<p class="muted">Your control tower — everything in ten seconds.</p>
   ${shot(s.dashboard, "Dashboard — key indicators, country map, priorities")}
   <table>
     <tr><th>Indicator</th><th>What it tells you</th></tr>
     <tr><td><b>Closure rate</b></td><td>Share of FAs ready to close, out of the total (animated ring).</td></tr>
     <tr><td><b>Response rate</b></td><td>Forms received vs forms expected.</td></tr>
     <tr><td><b>Open responses</b></td><td>Customers who haven't replied yet. The arrow shows the change since the last analysis.</td></tr>
     <tr><td><b>Qty missing</b></td><td>Units still to be received.</td></tr>
     <tr><td><b>Critical</b></td><td>FAs past their notification deadline.</td></tr>
   </table>
   <div class="grid2"><div>${step("Map", "Field Actions by country", "Each country is colored by its most urgent status. Click one to filter Monitoring.")}</div>
   <div>${step("List", "Needs attention", "The most urgent FAs with a suggested action. Click to open the detail.")}</div></div>`)}

${sec("6", "Monitoring",
  `<p class="muted">The full, filterable list of your Field Actions.</p>
   ${shot(s.monitoring, "Monitoring — quick filters, device, next action")}
   <p>Two rows of stackable filters: by <b>status</b> (All, Critical, Waiting Forms/GFE, Waiting Reconciliation, Ready, Blocked) and by <b>type</b> (Recall, Correction, Advisory). Each filter shows a count.</p>
   <table>
     <tr><th>Column</th><th>Meaning</th></tr>
     <tr><td><b>Device</b></td><td>The product concerned, taken from the folder name (or the description).</td></tr>
     <tr><td><b>Status</b></td><td>Colored closure badge (see section 12).</td></tr>
     <tr><td><b>Next action</b></td><td>What's left to do, computed automatically.</td></tr>
     <tr><td><b>Excel icon</b></td><td>Opens the source file in Excel to edit it.</td></tr>
   </table>
   ${note("info", "i", "Search, sort any column, choose visible columns, paginate. Click a row to open the full detail.")}`)}

${sec("7", "Field Action detail",
  `<p class="muted">Everything about one FA.</p>
   ${shot(s.detail, "FA detail — Summary tab: trend, blocker, customers to handle")}
   <p>The <b>Summary</b> tab is decision-ready: in one read you see <b>where the FA stands</b>, <b>why</b> it's blocked and <b>what to do next</b>.</p>
   <table>
     <tr><th>Tab</th><th>Content</th></tr>
     <tr><td><b>Summary</b></td><td>Trend lines (responses, quantities, rate), blocker reason, priority customers.</td></tr>
     <tr><td><b>Customers</b></td><td>One row per customer, response status and quantities.</td></tr>
     <tr><td><b>Lines</b></td><td>The file line by line (paginated).</td></tr>
     <tr><td><b>Quality</b></td><td>Any anomalies in the file.</td></tr>
     <tr><td><b>Follow-up</b></td><td>Your internal notes and a manual status (To chase, Waiting customer, Escalated…).</td></tr>
   </table>
   ${note("tip", "✓", "<b>Open in Excel</b> (top-right) opens the original source file to fix it. Re-run the analysis afterwards to refresh.")}`)}

${sec("8", "Priorities",
  `${shot(s.priorities, "Priorities — critical, waiting, manager summary")}
   <p>Groups the critical FAs, those waiting for forms and those waiting for reconciliation. At the bottom: a <b>ready-to-paste summary for your manager</b>, generated automatically.</p>`)}

${sec("9", "Data quality",
  `${shot(s.quality, "Data quality — actionable anomalies only")}
   <p class="muted">This screen shows only <b>real anomalies</b> in plain language (unreadable file, suspicious value…). Technical column-detection details stay hidden unless debug mode is on.</p>`)}

${sec("10", "Exports",
  `${shot(s.exports, "Exports — detailed Excel and visual PDF report")}
   <div class="grid2"><div>${step("Excel", "Detailed workbook", "Global KPIs, Monitoring view (rows tinted by status), blocking lines, per-FA detail.")}</div>
   <div>${step("PDF", "Visual report", "Header, colored KPI cards, progress bars, priorities. Ideal for a status update.")}</div></div>
   <p class="muted">A "filtered view only" option exports just what you see. Generation runs in the background — the app never freezes.</p>`)}

${sec("11", "History & Settings",
  `<div class="grid2"><div>${shot(s.history, "Analysis history")}</div><div>${shot(s.settings, "Settings")}</div></div>
   <p><b>History</b>: past analyses and a diff against the previous one. <b>Settings</b>: language, theme, the delay before an FA becomes "critical", and cache management.</p>`)}

${sec("12", "Closure statuses",
  `<p>Every Field Action moves through these states, in this order:</p>
   <table>
     <tr><th>Status</th><th>Meaning &amp; action</th></tr>
     ${status(C.orange, "Waiting Forms/GFE", "Customers haven't returned their form (VF / Ackn. Form). <b>Do:</b> chase the customers.")}
     ${status(C.amber, "Waiting Reconciliation", "Forms in, but quantities still to be received. <b>Do:</b> reconcile the product.")}
     ${status(C.green, "Ready for Closure", "Forms complete and quantities reconciled. <b>Do:</b> close the FA.")}
     ${status(C.red, "Blocked", "The file couldn't be analyzed. <b>Do:</b> check the source file.")}
   </table>
   <h3>The three Field Action types</h3>
   <p><b>Recall</b> and <b>Correction</b> track product returns/corrections via the <b>VF</b> column and quantity reconciliation. <b>Advisory</b> tracks only the acknowledgement (Ackn. Form), with no product return.</p>
   ${note("info", "i", "<b>Missing RGA</b> is flagged but never blocks a closure on its own.")}`)}

${sec("13", "Security & privacy",
  `<div class="cards">
     <div class="card"><b>100% local</b><div class="d">No internet, no data sent anywhere.</div></div>
     <div class="card"><b>Read-only</b><div class="d">Source Excel files are never modified.</div></div>
     <div class="card"><b>Protected access</b><div class="d">The app locks to your session; no other program on the PC can read the data.</div></div>
     <div class="card"><b>Isolated data</b><div class="d">Cache and exports live in your user profile, never in the source folder.</div></div>
   </div>`)}

${sec("14", "FAQ",
  `<h3>Did the app change my Excel file?</h3>
   <p class="muted">No, never. FieldPulse opens files read-only. The only way to edit a file is the "Open in Excel" button, which hands you back to Excel.</p>
   <h3>A wrong device name shows up?</h3>
   <p class="muted">The device name comes from the sub-folder that holds the file (or, failing that, the product description). Keep each Customer List in a sub-folder named after the device for an exact match.</p>
   <h3>The trend lines are flat?</h3>
   <p class="muted">Normal while there's only one analysis. Re-run an analysis a few days apart and the trends appear.</p>
   <h3>Windows warns me at launch?</h3>
   <p class="muted">SmartScreen does this for any unsigned app. "More info" → "Run anyway".</p>`)}

</body></html>`;
}

main().catch((e) => {
  console.error("[guide] failed:", e);
  process.exit(1);
});
