/**
 * Construit l'app native Windows (Electron) :
 *
 *   dist-desktop/app/        coquille Electron minimale (main + icône, zéro dep)
 *   dist-desktop/payload/    serveur + web + node_modules production + @facm/core
 *                            → packagé via extraResources (copie brute : la
 *                            collecte node_modules d'electron-builder perd des
 *                            dépendances transitives dans la cible portable)
 *   dist-desktop/out/        FACM-Setup-<v>.exe (NSIS) + FACM-Portable-<v>.exe
 *
 * Usage : npm run build:desktop [-- --dir]
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist-desktop");
const APP = path.join(OUT, "app");
const PAYLOAD = path.join(OUT, "payload");
const DIST = path.join(OUT, "out");
const DIR_ONLY = process.argv.includes("--dir");

const run = (cmd, cwd = ROOT) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
};
const cp = (src, dest) => fs.cpSync(src, dest, { recursive: true });

console.log("[1/5] Build TypeScript (core, server, web) + icône…");
run("npm run build");
run("node scripts/gen-icon.mjs");

console.log("[2/5] Staging payload (serveur + web + deps)…");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });
fs.mkdirSync(PAYLOAD, { recursive: true });

cp(path.join(ROOT, "apps/server/dist"), path.join(PAYLOAD, "server/dist"));
cp(path.join(ROOT, "apps/server/workers"), path.join(PAYLOAD, "server/workers"));
cp(path.join(ROOT, "apps/web/dist"), path.join(PAYLOAD, "web"));

const serverPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "apps/server/package.json"), "utf8"));
const corePkg = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/core/package.json"), "utf8"));
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

run(`npm pack ${JSON.stringify(path.join(ROOT, "packages/core"))} --pack-destination ${JSON.stringify(PAYLOAD)}`);
const coreTgz = fs.readdirSync(PAYLOAD).find((f) => f.startsWith("facm-core-") && f.endsWith(".tgz"));
if (!coreTgz) throw new Error("npm pack @facm/core a échoué");

fs.writeFileSync(
  path.join(PAYLOAD, "package.json"),
  JSON.stringify(
    {
      name: "facm-payload", private: true, version: rootPkg.version, type: "module",
      dependencies: { ...serverPkg.dependencies, ...corePkg.dependencies, "@facm/core": `file:${coreTgz}` },
    },
    null, 2
  )
);
run("npm install --omit=dev --no-audit --no-fund", PAYLOAD);
for (const probe of ["@facm/core/package.json", "@foliojs-fork/pdfkit/package.json", "fastify/package.json", "xlsx/package.json"]) {
  if (!fs.existsSync(path.join(PAYLOAD, "node_modules", probe))) {
    throw new Error(`Dépendance manquante dans le payload: ${probe}`);
  }
}

console.log("[3/5] Coquille Electron…");
fs.copyFileSync(path.join(ROOT, "apps/desktop/electron-main.mjs"), path.join(APP, "electron-main.mjs"));
fs.copyFileSync(path.join(ROOT, "build/icon.png"), path.join(APP, "icon.png"));
fs.writeFileSync(
  path.join(APP, "package.json"),
  JSON.stringify(
    {
      name: "fieldpulse", productName: "FieldPulse", version: rootPkg.version, private: true,
      main: "electron-main.mjs",
      description: "FieldPulse — Field Action monitoring dashboard (BSC internal)",
      author: "BSC Field Action Team",
    },
    null, 2
  )
);

console.log("[4/5] electron-builder…");
const electronVersion = JSON.parse(
  fs.readFileSync(path.join(ROOT, "node_modules/electron/package.json"), "utf8")
).version;
fs.writeFileSync(
  path.join(OUT, "builder.yml"),
  [
    "appId: com.bsc.fieldpulse",
    "productName: FieldPulse",
    `electronVersion: ${electronVersion}`,
    "directories:",
    `  app: ${JSON.stringify(APP)}`,
    `  output: ${JSON.stringify(DIST)}`,
    "asar: false",
    `icon: ${JSON.stringify(path.join(ROOT, "build/icon.png"))}`,
    `afterPack: ${JSON.stringify(path.join(ROOT, "scripts/after-pack.cjs"))}`,
    "win:",
    "  target:",
    "    - nsis",
    "    - portable",
    "nsis:",
    "  oneClick: false",
    "  perMachine: false",
    "  allowToChangeInstallationDirectory: true",
    "  createDesktopShortcut: true",
    "  createStartMenuShortcut: true",
    "  shortcutName: FieldPulse",
    `  artifactName: FieldPulse-Setup-\${version}.\${ext}`,
    "portable:",
    `  artifactName: FieldPulse-Portable-\${version}.\${ext}`,
  ].join("\n")
);
run(`npx electron-builder --win ${DIR_ONLY ? "--dir" : ""} --config ${JSON.stringify(path.join(OUT, "builder.yml"))}`);

console.log("[5/5] Vérification des artefacts…");
const unpackedPayload = path.join(DIST, "win-unpacked", "resources", "payload");
for (const probe of ["server/dist/main.js", "web/index.html", "node_modules/@facm/core/package.json", "node_modules/@foliojs-fork/pdfkit/package.json"]) {
  if (!fs.existsSync(path.join(unpackedPayload, probe))) {
    throw new Error(`Payload packagé incomplet: ${probe} manquant`);
  }
}
if (fs.existsSync(DIST)) {
  for (const f of fs.readdirSync(DIST)) {
    const st = fs.statSync(path.join(DIST, f));
    if (st.isFile()) console.log(`  ${f} — ${Math.round(st.size / 1024 / 1024)} Mo`);
  }
}
console.log(`\n✔ Terminé : ${DIST}`);
