/**
 * FieldPulse — app native Electron. Fenêtre unique, serveur Fastify in-process
 * (Electron 43 = Node 24 : node:sqlite + worker_threads natifs).
 *
 * Durcissement :
 *  - contextIsolation + sandbox, nodeIntegration off, devTools off (prod)
 *  - navigation verrouillée sur l'origine locale, window.open refusé
 *  - permissions navigateur (caméra, géoloc…) refusées
 *  - instance unique (focus de la fenêtre existante au relancement)
 *  - jeton de session API géré par le serveur (URL de lancement tokenisée)
 */
import { app, BrowserWindow, Menu, dialog, session, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV = !app.isPackaged;

/** Trace les erreurs de démarrage sur disque (diagnostic sans console). */
function logError(e) {
  try {
    const file = path.join(app.getPath("userData"), "facm-error.log");
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${e?.stack ?? e}\n`);
  } catch {
    /* best effort */
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** loadURL avec retries : le network service Chromium peut redémarrer au boot. */
async function loadWithRetry(win, url, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await win.loadURL(url);
      return;
    } catch (e) {
      logError(new Error(`loadURL tentative ${i}/${attempts}: ${e?.message ?? e}`));
      if (i === attempts) throw e;
      await sleep(800 * i);
    }
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  let origin = null;

  // Le payload (serveur + web + node_modules complets) vit dans extraResources :
  // copie brute par electron-builder, jamais filtrée par sa collecte de modules
  // (qui perd des dépendances transitives dans la cible portable).
  const payload = app.isPackaged
    ? path.join(process.resourcesPath, "payload")
    : path.join(__dirname, "..", "payload");

  // le serveur choisit un port libre ; les données vivent dans le profil utilisateur
  process.env.FACM_PORT = process.env.FACM_PORT ?? "0";
  process.env.FACM_HOST = "127.0.0.1";
  process.env.FACM_OPEN_BROWSER = "0";
  process.env.FACM_WEB_DIST = process.env.FACM_WEB_DIST ?? path.join(payload, "web");
  process.env.FACM_DATA_DIR = process.env.FACM_DATA_DIR ?? path.join(app.getPath("userData"), "data");

  Menu.setApplicationMenu(null);

  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      // les liens externes éventuels partent dans le navigateur système, jamais dans l'app
      if (origin && !url.startsWith(origin)) void shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (!origin || !url.startsWith(origin)) event.preventDefault();
    });
  });

  app.on("window-all-closed", () => app.quit());

  app
    .whenReady()
    .then(async () => {
      session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

      const serverEntry = path.join(payload, "server", "dist", "main.js");
      const { startServer } = await import(pathToFileURL(serverEntry).href);
      const info = await startServer();
      origin = info.url;

      win = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 640,
        backgroundColor: "#0a1020",
        autoHideMenuBar: true,
        show: false,
        icon: path.join(__dirname, "icon.png"),
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          devTools: DEV,
          spellcheck: false,
        },
      });
      win.once("ready-to-show", () => win.show());
      win.on("closed", () => { win = null; });
      await loadWithRetry(win, info.launchUrl);
    })
    .catch((e) => {
      logError(e);
      dialog.showErrorBox("FieldPulse — démarrage impossible", String(e?.stack ?? e));
      app.quit();
    });
}
