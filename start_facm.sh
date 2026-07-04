#!/usr/bin/env bash
# FACM - Field Action Closure Monitoring (macOS / Linux)
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[FACM] Node.js est requis (version 22+). Installez-le depuis https://nodejs.org"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[FACM] Première installation des dépendances..."
  npm install --no-audit --no-fund
fi

if [ ! -d apps/web/dist ]; then
  echo "[FACM] Compilation de l'application..."
  npm run build
fi

echo "[FACM] Démarrage sur http://127.0.0.1:4560 ..."
FACM_OPEN_BROWSER=1 node apps/server/dist/main.js
