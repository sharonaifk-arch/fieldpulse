/**
 * Hook electron-builder afterPack : copie le payload (serveur + web +
 * node_modules complets) dans resources/ APRÈS l'empaquetage, en copie brute.
 * Ni la collecte de modules ni les filtres extraResources ne s'appliquent ici —
 * c'est le seul chemin qui garantit un node_modules intact dans le portable.
 */
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function afterPack(context) {
  const payloadSrc = path.resolve(__dirname, "..", "dist-desktop", "payload");
  const dest = path.join(context.appOutDir, "resources", "payload");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(payloadSrc, dest, { recursive: true });
  const probe = path.join(dest, "node_modules", "@facm", "core", "package.json");
  if (!fs.existsSync(probe)) throw new Error(`afterPack: payload incomplet (${probe})`);
  console.log(`  • payload copié → ${dest}`);
};
