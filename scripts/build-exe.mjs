/**
 * Builds the lightweight portable Windows executable (Node SEA — no Electron):
 *
 *   dist-portable/FieldPulse/
 *     FieldPulse.exe    <- Node SEA launcher (embeds the Node runtime itself)
 *     LISEZMOI.txt
 *     resources/
 *       server/         <- compiled Fastify server + analysis worker
 *       web/            <- built frontend
 *       node_modules/   <- production dependencies only (+ @facm/core)
 *
 * Double-clicking FieldPulse.exe starts the local server and opens the browser.
 * End users need NOTHING installed (no Node, no npm). Data (cache SQLite,
 * exports) is stored in %LOCALAPPDATA%\FieldPulse\data.
 *
 * NOTE: `npm run build:desktop` also ships a portable (native Electron window).
 * This SEA build is the lighter browser-based alternative (~88 MB vs ~118 MB).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist-portable");
const APP = path.join(OUT, "FieldPulse");
const RES = path.join(APP, "resources");
const BUILD = path.join(OUT, "build");

const run = (cmd, cwd = ROOT) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
};
const cp = (src, dest) => fs.cpSync(src, dest, { recursive: true });

console.log("[1/6] Build TypeScript (core, server, web)…");
run("npm run build");

console.log("[2/6] Staging…");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(RES, { recursive: true });
fs.mkdirSync(BUILD, { recursive: true });

cp(path.join(ROOT, "apps/server/dist"), path.join(RES, "server/dist"));
cp(path.join(ROOT, "apps/server/workers"), path.join(RES, "server/workers"));
cp(path.join(ROOT, "apps/web/dist"), path.join(RES, "web"));

console.log("[3/6] Production dependencies…");
const serverPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "apps/server/package.json"), "utf8"));
const corePkg = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/core/package.json"), "utf8"));
const deps = { ...serverPkg.dependencies, ...corePkg.dependencies };
delete deps["@facm/core"]; // copied manually below (workspace package)
fs.writeFileSync(
  path.join(RES, "package.json"),
  JSON.stringify({ name: "facm-portable", private: true, version: "1.0.0", type: "module", dependencies: deps }, null, 2)
);
run("npm install --omit=dev --no-audit --no-fund", RES);

// @facm/core into the staged node_modules
const coreDest = path.join(RES, "node_modules", "@facm", "core");
fs.mkdirSync(coreDest, { recursive: true });
cp(path.join(ROOT, "packages/core/dist"), path.join(coreDest, "dist"));
fs.copyFileSync(path.join(ROOT, "packages/core/package.json"), path.join(coreDest, "package.json"));

console.log("[4/6] SEA launcher…");
const launcher = `"use strict";
// FieldPulse portable launcher — embedded in the exe via Node SEA.
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const exeDir = path.dirname(process.execPath);
const resources = path.join(exeDir, "resources");
process.env.FACM_WEB_DIST = process.env.FACM_WEB_DIST || path.join(resources, "web");
process.env.FACM_DATA_DIR =
  process.env.FACM_DATA_DIR || path.join(process.env.LOCALAPPDATA || exeDir, "FieldPulse", "data");
process.env.FACM_OPEN_BROWSER = process.env.FACM_OPEN_BROWSER || "1";
console.log("FieldPulse — Field Action Monitoring");
console.log("Fermez cette fenetre pour arreter l'application.");
import(pathToFileURL(path.join(resources, "server", "dist", "main.js")).href)
  .then((mod) => mod.startServer())
  .catch((e) => {
    if (e && e.code === "EADDRINUSE") {
      console.log("[FieldPulse] deja lance - ouverture du navigateur.");
      require("node:child_process").spawn("cmd", ["/c", "start", "", "http://127.0.0.1:4560"], { detached: true, stdio: "ignore" });
      setTimeout(() => process.exit(0), 500);
      return;
    }
    console.error("[FieldPulse] demarrage impossible:", e);
    console.log("Appuyez sur Ctrl+C pour fermer.");
  });
`;
fs.writeFileSync(path.join(BUILD, "launcher.cjs"), launcher);
fs.writeFileSync(
  path.join(BUILD, "sea-config.json"),
  JSON.stringify({ main: "launcher.cjs", output: "sea.blob", disableExperimentalSEAWarning: true }, null, 2)
);
run(`"${process.execPath}" --experimental-sea-config sea-config.json`, BUILD);

console.log("[5/6] Injection dans l'exécutable…");
const exePath = path.join(APP, "FieldPulse.exe");
fs.copyFileSync(process.execPath, exePath);
run(
  `npx postject "${exePath}" NODE_SEA_BLOB "${path.join(BUILD, "sea.blob")}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
  ROOT
);

console.log("[6/6] Notice…");
fs.writeFileSync(
  path.join(APP, "LISEZMOI.txt"),
  [
    "FieldPulse - Field Action Monitoring (version portable)",
    "",
    "1. Copiez le dossier FieldPulse ou vous voulez (cle USB, Bureau, etc.).",
    "2. Double-cliquez FieldPulse.exe : le navigateur s'ouvre sur http://127.0.0.1:4560",
    "3. Fermez la fenetre noire pour arreter l'application.",
    "",
    "Aucune installation requise. Aucune connexion internet requise.",
    "Vos donnees (cache, exports, commentaires) sont dans %LOCALAPPDATA%\\FieldPulse\\data",
    "Les fichiers Excel sources ne sont JAMAIS modifies.",
    "",
    "Premier lancement : Windows SmartScreen peut afficher un avertissement",
    "(application non signee) -> 'Informations complementaires' puis 'Executer quand meme'.",
  ].join("\r\n")
);

fs.rmSync(BUILD, { recursive: true, force: true });
const size = Math.round(fs.statSync(exePath).size / 1024 / 1024);
console.log(`\n✔ Terminé : ${APP}`);
console.log(`  FieldPulse.exe (${size} Mo) + resources/`);
