@echo off
setlocal
cd /d "%~dp0"
title FACM - Field Action Closure Monitoring

where node >nul 2>nul
if errorlevel 1 (
  echo [FACM] Node.js est requis mais introuvable.
  echo         Installez-le depuis https://nodejs.org (version 22 ou plus^), puis relancez.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [FACM] Premiere installation des dependances...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo [FACM] Echec de l'installation. & pause & exit /b 1 )
)

if not exist apps\web\dist (
  echo [FACM] Compilation de l'application...
  call npm run build
  if errorlevel 1 ( echo [FACM] Echec de la compilation. & pause & exit /b 1 )
)

echo [FACM] Demarrage sur http://127.0.0.1:4560 ...
set FACM_OPEN_BROWSER=1
node apps\server\dist\main.js
pause
