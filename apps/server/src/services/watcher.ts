/**
 * Background folder watching (chokidar). When .xlsx files change in the
 * watched folder, a debounced "files-changed" SSE event tells the UI to
 * offer a refresh. One watcher at a time — enough for the internal use case.
 */
import chokidar, { type FSWatcher } from "chokidar";
import { sseEmit } from "../sse.js";

let watcher: FSWatcher | null = null;
let watchedPath: string | null = null;
let debounce: NodeJS.Timeout | null = null;
const changed = new Set<string>();

export function getWatchStatus(): { active: boolean; path: string | null } {
  return { active: watcher !== null, path: watchedPath };
}

export async function stopWatch(): Promise<void> {
  if (watcher) await watcher.close();
  watcher = null;
  watchedPath = null;
}

export async function startWatch(folderPath: string): Promise<void> {
  await stopWatch();
  watcher = chokidar.watch(folderPath, {
    ignoreInitial: true,
    depth: 3,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 300 },
  });
  watchedPath = folderPath;
  const onEvent = (p: string) => {
    if (!p.toLowerCase().endsWith(".xlsx") || p.includes("~$")) return;
    changed.add(p);
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      sseEmit("watch", "files-changed", { path: watchedPath, files: [...changed] });
      changed.clear();
    }, 2000);
  };
  watcher.on("add", onEvent).on("change", onEvent).on("unlink", onEvent);
}
