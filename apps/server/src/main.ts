/**
 * FACM server. Exporte startServer() (utilisé par l'app Electron et le
 * lanceur portable) et démarre automatiquement en usage CLI
 * (`node dist/main.js`). Un seul process, un seul port, 100 % offline.
 */
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { CONFIG, ensureDirs } from "./config.js";
import { getDb } from "./db.js";
import { registerRoutes } from "./routes.js";

function openBrowser(url: string): void {
  if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url.replace(/&/g, "^&")], { detached: true, stdio: "ignore" });
  else if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" });
  else spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
}

export interface ServerInfo {
  url: string;
  /** URL avec jeton de session — à ouvrir dans le navigateur/la fenêtre */
  launchUrl: string;
  port: number;
  token: string | null;
}

/** Construit l'app Fastify complète sans l'attacher à un port (utilisé par les tests). */
export async function buildApp(): Promise<ReturnType<typeof Fastify>> {
  ensureDirs();
  getDb(); // run migrations up-front

  const app = Fastify({ logger: { level: "warn" }, bodyLimit: 50 * 1024 * 1024 });
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024, files: 50 } });

  /* ---- garde-fous sécurité (app interne, données PII) ---- */

  // jeton de session : bloque l'accès API aux autres process locaux
  app.addHook("onRequest", (req, reply, done) => {
    if (!CONFIG.token || !req.url.startsWith("/api/") || req.url === "/api/health") return done();
    const header = req.headers["x-facm-token"];
    const query = (req.query as Record<string, string> | undefined)?.token;
    if (header === CONFIG.token || query === CONFIG.token) return done();
    reply.code(401).send({ error: "Session invalide — relancez FACM depuis son raccourci." });
  });

  // en-têtes durcis sur toutes les réponses
  app.addHook("onSend", (req, reply, payload, done) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (req.url.startsWith("/api/")) {
      reply.header("Cache-Control", "no-store");
    } else {
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; " +
          "frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
      );
    }
    done(null, payload);
  });

  registerRoutes(app);

  if (fs.existsSync(CONFIG.webDist)) {
    await app.register(fastifyStatic, { root: CONFIG.webDist });
    // SPA fallback: any non-API route serves index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
      return reply.sendFile("index.html");
    });
  }

  return app;
}

export async function startServer(): Promise<ServerInfo> {
  const app = await buildApp();
  await app.listen({ port: CONFIG.port, host: CONFIG.host });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : CONFIG.port;
  const url = `http://${CONFIG.host}:${port}`;
  const launchUrl = CONFIG.token ? `${url}/?facmtoken=${CONFIG.token}` : url;

  console.log(`[FACM] ready on ${url} (workers: ${CONFIG.workers})`);
  if (CONFIG.token) console.log(`[FACM] session: ${launchUrl}`);
  if (CONFIG.openBrowser) openBrowser(launchUrl);

  return { url, launchUrl, port, token: CONFIG.token };
}

/* ---- démarrage automatique en usage CLI (node dist/main.js) ---- */
const isCli = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  startServer().catch((e) => {
    if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") {
      const url = `http://${CONFIG.host}:${CONFIG.port}`;
      console.log(`[FACM] déjà en cours d'exécution sur ${url} — ouverture du navigateur.`);
      if (CONFIG.openBrowser) openBrowser(url);
      process.exit(0);
    }
    console.error("[FACM] fatal:", e);
    process.exit(1);
  });
}
