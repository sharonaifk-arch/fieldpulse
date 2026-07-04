/**
 * Analysis worker (worker_threads). Plain ESM JavaScript so the same file
 * runs in dev (tsx) and prod (node dist) without compilation. Stays alive
 * and processes messages: { id, filePath, fileName, options }.
 */
import { parentPort } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { analyzeWorkbook } from "@facm/core";

parentPort.on("message", async (msg) => {
  const { id, filePath, fileName, options } = msg;
  try {
    const buf = await readFile(filePath);
    const result = analyzeWorkbook(buf, fileName, options);
    parentPort.postMessage({ id, ok: true, result });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
