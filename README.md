# FACM — Field Action Closure Monitoring

Application interne **100 % locale et offline** pour suivre l'état de clôture des Field Actions
(Recall, Advisory, Correction) à partir des fichiers Excel « Customer List » BSC, sans jamais
ouvrir ni modifier les fichiers sources.

![status](https://img.shields.io/badge/tests-25%2F25-success) ![node](https://img.shields.io/badge/node-%E2%89%A522.5-blue)

---

## 1. Stack retenue et justification

| Couche | Choix | Pourquoi |
|---|---|---|
| Langage | **TypeScript partout** | Un seul langage à maintenir ; typage strict de bout en bout (les types du moteur sont réutilisés par le serveur ET le frontend) |
| Moteur métier | Package pur `@facm/core` | Zéro dépendance UI/serveur, testé unitairement (Vitest), règles isolées |
| Lecture Excel | **SheetJS (`xlsx`)** | Éprouvé sur les fichiers réels (feuilles de 80 000+ lignes) ; lecture en 3 passes pour ne jamais parser les feuilles de référence inutiles |
| Serveur | **Node 22 + Fastify** | Léger, rapide, un seul process ; sert aussi le frontend compilé |
| Cache | **SQLite via `node:sqlite`** | Intégré à Node ≥ 22.5 : **aucune compilation native**, aucune dépendance fragile |
| Parallélisme | `worker_threads` (pool) | L'analyse Excel (CPU) ne bloque jamais l'interface |
| Frontend | **React 19 + Vite + Tailwind 4** | Qualité UI type Linear/Vercel : dark mode, skeletons, toasts, tableaux riches (TanStack Table), graphiques (Recharts) |
| Exports | exceljs (Excel) + pdfmake (PDF) | Générés en tâches asynchrones, polices standards = zéro fichier externe |

**Alternatives écartées :**
- *Python + Streamlit/Dash* : impossible d'atteindre la fluidité et la qualité graphique demandées ; pandas convertit silencieusement `"N/A"` en NaN, ce qui masque une règle métier clé des fichiers Correction.
- *Python FastAPI + front React* : deux runtimes à installer et maintenir pour un non-développeur.
- *Tauri / Electron* : toolchain de build lourde pour un gain marginal en interne.
- *App 100 % statique (navigateur seul)* : le scan d'un dossier local Teams/OneDrive exige un accès filesystem qu'un navigateur n'a pas.

## 2. Trois façons d'utiliser FACM

### A. App native Windows (recommandée — rendu final)

```bash
npm run build:desktop
```

produit dans **`dist-desktop/out/`** :
- **`FACM-Setup-1.0.0.exe`** — installeur (raccourcis Bureau + menu Démarrer,
  désinstallation propre, aucun droit admin requis) ;
- **`FACM-Portable-1.0.0.exe`** — exe unique à copier n'importe où (clé USB…).

Double-clic → **fenêtre native FACM** (Electron 43, serveur intégré au process,
aucun navigateur requis). Données : `%APPDATA%\FACM\data`. Premier lancement :
SmartScreen peut avertir (exe non signé) → « Informations complémentaires »
puis « Exécuter quand même ». Le **portable** s'extrait dans un dossier
temporaire au premier lancement : comptez ~1 minute avant l'ouverture de la
fenêtre (instantané ensuite). L'installeur n'a pas ce délai.

Sécurité intégrée : fenêtre sandboxée (contextIsolation, nodeIntegration off,
navigation verrouillée sur l'origine locale), permissions navigateur refusées,
instance unique, **jeton de session API** — voir §6 Sécurité.

### B. Lanceur léger `.exe` + navigateur (alternative)

```bash
npm run build:exe
```

produit **`dist-portable/FACM/`** : `FACM.exe` (88 Mo, runtime Node embarqué) +
`resources/`. Double-clic → l'app s'ouvre dans le navigateur par défaut avec
l'URL de session tokenisée. Données : `%LOCALAPPDATA%\FACM\data`.

### C. Depuis les sources (développement)

1. Installer **Node.js 24 LTS** : https://nodejs.org (minimum 23.4 pour `node:sqlite`).
2. Double-cliquer **`start_facm.bat`** (Windows) ou lancer `./start_facm.sh` (macOS/Linux).

Le premier lancement installe les dépendances et compile l'application (2–3 min).
Les lancements suivants démarrent en ~2 secondes. Le navigateur s'ouvre sur
**http://127.0.0.1:4560**.

### Lancement manuel (équivalent)

```bash
npm install        # une fois
npm run build      # une fois (et après chaque mise à jour du code)
npm start          # démarre le serveur local sur http://127.0.0.1:4560
```

### Mode développeur

```bash
npm run dev        # serveur (4560) + Vite hot-reload (5173)
npm test           # tests unitaires du moteur (25 tests)
```

## 3. Les trois modes de chargement

| Mode | Où | Comment |
|---|---|---|
| **Upload manuel** | Sources → Upload | Glisser-déposer des `.xlsx` ; analyse immédiate |
| **Scan de dossier** | Sources → Scan | Coller le chemin d'un dossier Teams/OneDrive synchronisé ; options : sous-dossiers, mots-clés, pays, taille max. Les fichiers `~$...` et les dossiers `archive/backup/old/snapshots/exports` sont ignorés automatiquement |
| **Bibliothèque** | Sources → Bibliothèque | Dossiers favoris (chemin + filtres) réutilisables en un clic |

## 4. Le cache intelligent

- Chaque fichier est identifié par le **SHA256 de son contenu** : renommer ou re-télécharger
  un fichier identique ne déclenche pas de re-analyse.
- Les résultats sont stockés dans `data/facm.sqlite` avec la **version du moteur** : toute
  évolution des règles invalide automatiquement le cache concerné.
- « Analyser les nouveaux/modifiés » ne relit que ce qui a changé ; « Forcer l'analyse
  complète » ignore le cache ; « Vider le cache » (Réglages) repart de zéro.
- Le dossier `data/` contient aussi les exports générés. Il peut être supprimé sans risque
  (seuls les commentaires/statuts de suivi internes y sont perdus).

## 5. Règles métier implémentées (résumé)

- **Forms Received** = Sold To avec au moins une ligne VF = 1 · **Closed by GFE** = VF = GFE ·
  **Open** = ni l'un ni l'autre · **Taux** = (reçus + GFE) / attendus.
- **Qty Missing** = max(Qty to return − max(Qty locale, Qty DC), 0) ; RGA manquant est signalé
  mais **jamais bloquant** seul.
- **Statut de clôture** : Waiting Forms/GFE → Waiting Reconciliation → **Ready for Closure**.
- **Règle Correction (non évidente)** : les lignes `VF = "N/A"` des fichiers Correction et
  Recall/Correction sont **hors périmètre** et exclues de tous les comptages (tracées dans
  Data Quality). Pour un Recall pur, `N/A` reste « À vérifier ».
- Advisory (et Correction « MM ») : suivi via `Ackn. Form` sur la feuille MM, pas de
  réconciliation quantités.

## 6. Sécurité

- **Écoute `127.0.0.1` uniquement** — rien n'est exposé sur le réseau ; aucune
  connexion sortante ; fichiers Excel ouverts en lecture seule.
- **Jeton de session API** : généré aléatoirement à chaque démarrage et injecté
  dans l'URL de lancement. Tout appel `/api/*` sans ce jeton reçoit 401 — un
  autre process local (malware non privilégié, autre appli) ne peut pas lire
  les données PII via l'API. Désactivable uniquement en dev (`FACM_DISABLE_TOKEN=1`).
- **En-têtes durcis** : CSP stricte (`default-src 'self'`, pas de script externe),
  `nosniff`, `frame-ancestors 'none'`, `Cache-Control: no-store` sur l'API.
- **Validation des entrées** : chemins de scan vérifiés (dossier réel, longueur,
  pas de caractère nul) ; téléchargement d'exports confiné au dossier `data/exports`.
- **Fenêtre Electron sandboxée** : contextIsolation, nodeIntegration désactivé,
  window.open refusé, navigation hors origine locale bloquée, permissions
  (caméra, micro, géoloc) refusées, menu applicatif supprimé.
- Recommandé pour une diffusion large : signer les exe avec un certificat
  code-signing interne (supprime l'avertissement SmartScreen).

## 7. Contraintes connues

- Fichiers `.xlsx` uniquement (pas `.xls` ancien format).
- Le type est déduit des colonnes **et** du nom de fichier : garder « Correction » /
  « Advisory » dans les noms aide la détection.
- Deux fichiers portant la même référence FA apparaissent comme deux lignes distinctes
  (identité = contenu du fichier).
- L'app écoute uniquement sur `127.0.0.1` : aucune donnée ne sort du poste.
- Les dates ambiguës `a/b/yy` sont lues jour-premier (fichiers EU), avec repli US si invalide.

## 8. Structure du projet

```
packages/core     moteur métier pur (parsing Excel + règles + tests)
apps/server       Fastify : scan, hash, cache SQLite, workers, exports, SSE, sécurité
apps/web          React 19 : design system v2 (ui-ux-pro-max), carte Europe animée,
                  KPIs anime.js, FR/EN, dark/light
apps/desktop      main Electron (fenêtre native sécurisée)
scripts/          build exe/desktop, génération carte Europe + icône
data/             (généré) cache SQLite, uploads, exports
```

**Design system** : généré avec le skill `ui-ux-pro-max` (style « Data-Dense
Dashboard », Fira Code + Fira Sans, palette bleu/ambre, statuts vert/ambre/rouge,
densité dashboard). Animations **anime.js** : compteurs KPI, entrées en cascade,
transitions de pages, pulsations de la carte — `prefers-reduced-motion` respecté.
**Carte Europe** : SVG généré build-time depuis Natural Earth
(`scripts/gen-europe-map.mjs`), pays colorés par statut, clic = filtre Monitoring.

Voir [ARCHITECTURE.md](ARCHITECTURE.md) pour les décisions techniques détaillées.

## 9. Roadmap suggérée

1. Signature code-signing des exe (supprime SmartScreen).
2. Historisation longue durée + tendances temporelles (le schéma SQLite versionné le permet déjà).
3. Vue « owner » (en plus du pays) quand la colonne owner existera dans les fichiers.
4. Notifications Windows natives à l'approche des deadlines.
5. Export PowerPoint de synthèse mensuelle.
6. Auto-update interne (dossier partagé de versions + vérification au démarrage).
