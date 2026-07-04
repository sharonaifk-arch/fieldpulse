# ARCHITECTURE — FACM

## Vue d'ensemble

```
┌──────────────┐   REST + SSE   ┌──────────────────┐    appelle    ┌────────────────┐
│  apps/web    │ ─────────────▶ │  apps/server     │ ────────────▶ │ packages/core  │
│  React 19    │ ◀───────────── │  Fastify (Node)  │               │ moteur pur TS  │
└──────────────┘                └──────────────────┘               └────────────────┘
   Zustand, i18n                  SQLite (node:sqlite)               SheetJS lecture
   TanStack, Recharts             worker_threads pool                 seule, JSON-safe
```

**Séparation stricte** : le frontend n'implémente aucune règle métier (il affiche des
résultats déjà calculés) ; le serveur n'en implémente aucune non plus (il orchestre) ;
tout le métier vit dans `packages/core`, testable sans Excel réel.

## Décisions clés

### 1. Lecture Excel en 3 passes (packages/core/src/excel/workbookReader.ts)
Les fichiers réels contiennent des feuilles de référence énormes (« Latitude Master » :
80 000+ lignes) qu'il ne faut jamais parser entièrement :
1. `bookSheets: true` → noms de feuilles uniquement ;
2. lecture **15 lignes** par feuille → détection d'en-tête + score ;
3. lecture complète de la **seule** feuille principale retenue.

### 2. Détection score-based (sheetDetector / headerDetector)
- Chaque ligne candidate est scorée par les colonnes canoniques reconnues (poids :
  `vf`/`acknForm` 5, `soldTo` 4, etc.) — tolère la ligne 1 « méta-groupes » fusionnée
  des feuilles FA (en-têtes réels en ligne 2) et les feuilles MM (en-têtes ligne 1).
- Chaque feuille est scorée (colonnes + pénalité de nom : latitude/sap/dhl/master…) ;
  une feuille VF bat une feuille Ackn. Form à score égal (le VF est la source
  d'autorité Recall/Correction).
- Alias : correspondance sur forme normalisée (minuscules, ponctuation retirée).
  `vf` exige une **égalité exacte** car « Qty to return (stated on VF) » contient aussi « vf ».

### 3. Types de FA et modes de tracking (typeDetector)
Deux axes indépendants :
- `faType` : recall / advisory / correction / recall-correction / unknown
  (colonnes du sheet retenu + indices du nom de fichier) ;
- `trackingMode` : **vf** (feuille FA) ou **ack** (feuille MM, `Ackn. Form`).
Un fichier « Correction MM » (sans feuille VF) est bien une Correction trackée en mode ack.

### 4. Règle N/A des corrections (rulesEngine)
Constat terrain : les fichiers Correction marquent `VF = "N/A"` (chaîne littérale) les
lignes hors périmètre — la quasi-totalité du fichier. Décision (validée métier) :
- correction & recall-correction → lignes N/A **exclues** de tous les comptages
  (`kpis.excludedLines`, statut ligne `excluded`) ;
- recall / advisory purs → N/A = `review` (règle stricte).

### 5. Cache et invalidation (apps/server/src/db.ts, analyzer.ts)
- Clé = SHA256 du contenu (streaming) ; taille+mtime ne servent qu'à l'affichage.
- Une analyse est réutilisable si `(file_hash, engine_version, cache_version)` correspond.
  `ENGINE_VERSION` (core) est bumpée à chaque évolution de règle → invalidation ciblée.
- Migrations SQLite versionnées (`meta.schema_version`) pour préserver annotations et
  bibliothèque lors des mises à jour.

### 6. Résultats volumineux : summary / lines séparés
Un hybride réel fait 86 000 lignes. `AnalysisResult` est donc persisté en deux colonnes
JSON : `summary_json` (tout sauf les lignes — envoyé en liste au frontend) et
`lines_json` (servi **paginé et filtré** par `/api/analyses/:id/lines`). L'UI ne charge
jamais 86 000 lignes d'un coup.

### 7. Parallélisme (analyzer.ts + workers/analyze.worker.mjs)
Pool de `worker_threads` persistants (taille = min(CPU−1, 4), configurable
`FACM_WORKERS`). Le worker est un `.mjs` volontairement **non compilé** : le même
fichier tourne en dev (tsx) et en prod (node dist). Le hash est séquentiel (I/O),
l'analyse est parallèle (CPU).

### 8. Progression temps réel (sse.ts)
SSE plutôt que WebSocket : unidirectionnel, zéro dépendance, reconnexion native
navigateur. Canaux : `runs` (progression), `watch` (chokidar), `exports`.

### 9. Exports asynchrones (exports/jobs.ts)
`POST /api/exports` ne fait qu'enfiler un job (table `export_jobs`) ; la génération
tourne hors requête. PDF via pdfmake avec polices Helvetica standard = aucun fichier
de police embarqué, fonctionne offline.

### 10. JSON-safe partout
Contrat du moteur : jamais de NaN/Infinity/Date — nombres finis ou `null`, dates ISO
`yyyy-mm-dd`. Garanti par `jsonSafe()`/`parseDate()` et vérifié par les tests.

### 11. Identité d'une FA dans l'UI
Deux fichiers peuvent partager la même référence (ex. la liste principale et son
extract « MM »). La navigation utilise donc le **hash du fichier** ; les annotations
(commentaire, statut de suivi manuel) restent par référence FA, ce qui est le grain
métier voulu.

## Flux d'une analyse

1. UI → `POST /api/scan/run` (ou upload) → `startRun()` crée la ligne `runs`.
2. Pour chaque fichier : SHA256 → hit cache ? réutilise : dispatch worker.
3. Worker : lecture 3 passes → détection type → moteur de règles → `AnalysisResult`.
4. Persistance (`analyses`), progression SSE par fichier, stats finales sur `runs`.
5. UI recharge `/api/runs/latest/results` (summaries seulement) et rafraîchit les vues.

## v2 — App native, design system, sécurité (2026-07-04)

### 12. App native Electron (apps/desktop)
Electron 43 embarque Node 24.17 → `node:sqlite` et `worker_threads` disponibles
nativement : le serveur Fastify tourne **in-process** dans le main Electron
(aucun module natif, aucun sidecar). `startServer()` est exportée par
`apps/server/src/main.ts` (port dynamique `FACM_PORT=0` sous Electron) ; le mode
CLI reste auto-démarrant. Packaging `scripts/build-desktop.mjs` : staging
autonome (deps prod npm + @facm/core copié) puis electron-builder → NSIS +
portable. Le lanceur SEA (`build:exe`) reste disponible comme alternative légère.

### 13. Jeton de session API
`CONFIG.token` (aléatoire 48 hex au boot, ou fourni par le lanceur) est exigé
sur `/api/*` (header `X-FACM-Token`, ou `?token=` pour les flux SSE qui
n'acceptent pas d'en-têtes). Le lanceur transmet le jeton via
`/?facmtoken=…` ; le front le stocke en sessionStorage et nettoie l'URL.
But : empêcher un autre process local de lire les données PII via l'API.
`/api/health` reste public (sonde de vivacité). Désactivé en dev
(`npm run dev` ou `FACM_DISABLE_TOKEN=1`).

### 14. Design system v2 + animations
Généré via le skill `ui-ux-pro-max` (« Data-Dense Dashboard », persisté dans
`design-system/MASTER.md`) : Fira Sans (corps) + Fira Code (données, KPIs,
`font-variant-numeric: tabular-nums`), palette bleu #1E40AF/#3B82F6 + ambre,
densité 8 (spacing 8–32px), dual-thème (tokens CSS remappés, jamais inversés).
Animations **anime.js v4** centralisées dans `apps/web/src/anim.ts` :
`useCountUp` (KPIs), `useStaggerIn` (38ms/item), `usePageEnter` (220ms) —
toutes court-circuitées par `prefers-reduced-motion`.

### 15. Carte Europe
`scripts/gen-europe-map.mjs` (build-time) : Natural Earth 50m → projection
azimutale équivalente centrée Europe → paths SVG figés dans
`apps/web/src/map/europe.gen.ts` (~150 Ko, 39 pays). Les MultiPolygons sont
**clippés à la bbox Europe** (sinon la Guyane française écrase le cadrage).
Statut pays = pire statut de ses FA ; pulsations = FA non clôturées ;
clic = préréglage de recherche du Monitoring (store `monitoringSearch`).

## Sécurité / robustesse

- Écoute `127.0.0.1` uniquement ; aucune connexion sortante ; fichiers sources ouverts
  en lecture seule.
- Un fichier illisible ou mal structuré produit un résultat `blocked` + message clair
  (Data Quality) — jamais d'échec de batch.
- Les erreurs affichées à l'utilisateur sont en langage métier ; le détail technique
  reste dans le log serveur / le mode debug (toggle Réglages).
