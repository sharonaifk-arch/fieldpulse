/** Data sources: manual upload, folder scan with cache preview, library. */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderSearch, Upload, Star, Trash2, Radio, Loader2, ChevronDown, ChevronRight, ArrowRight, CheckCircle2 } from "lucide-react";
import { api } from "../api";
import { useAppStore } from "../store";
import { useT } from "../i18n";
import { Button, Card, Checkbox, Input, ProgressBar } from "../components/ui";
import { fileSize } from "../format";

interface ScanOpts {
  includeSubfolders: boolean;
  keywords: string;
  countries: string;
  maxFileSizeMb: number;
}

const toApiOptions = (o: ScanOpts) => ({
  includeSubfolders: o.includeSubfolders,
  keywords: o.keywords.split(",").map((s) => s.trim()).filter(Boolean),
  countries: o.countries.split(",").map((s) => s.trim()).filter(Boolean),
  maxFileSizeMb: o.maxFileSizeMb,
});

export function Sources() {
  const t = useT();
  const nav = useNavigate();
  const { toast, progress, setWatchedPath, watchedPath, setFilesChanged } = useAppStore();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File[]>([]);
  const [path, setPath] = useState(localStorage.getItem("facm.lastPath") ?? "");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [opts, setOpts] = useState<ScanOpts>({ includeSubfolders: true, keywords: "", countries: "", maxFileSizeMb: 100 });
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.scanPreview>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [folders, setFolders] = useState<Array<{ id: number; label: string; path: string; options_json: string }>>([]);
  const [folderLabel, setFolderLabel] = useState("");

  const loadFolders = () => void api.libraryFolders().then(setFolders).catch(() => {});
  useEffect(loadFolders, []);

  const analyzing = progress !== null && progress.done < progress.total;

  const runScan = async (force: boolean) => {
    if (!path) return;
    setBusy(true);
    try {
      localStorage.setItem("facm.lastPath", path);
      await api.scanRun(path, toApiOptions(opts), force);
      setFilesChanged(false);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : t("misc.error"));
    } finally {
      setBusy(false);
    }
  };

  const doPreview = async () => {
    if (!path) return;
    setBusy(true);
    try {
      setPreview(await api.scanPreview(path, toApiOptions(opts)));
    } catch (e) {
      toast("error", e instanceof Error ? e.message : t("misc.error"));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const doUpload = async () => {
    if (pending.length === 0) return;
    setBusy(true);
    try {
      await api.upload(pending);
      setPending([]);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : t("misc.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {/* progress banner — rassurant, puis guide vers le Dashboard */}
      {progress && (
        <Card className="xl:col-span-2">
          <div className="flex items-center gap-3">
            {analyzing ? (
              <Loader2 size={16} className="shrink-0 animate-spin text-accent" />
            ) : (
              <CheckCircle2 size={16} className="shrink-0 text-ok" />
            )}
            <div className="flex-1">
              <div className="mb-1.5 flex justify-between text-[12px] text-muted">
                <span>
                  {analyzing ? `${t("sources.analyzing")} ${progress.current ?? ""}` : t("sources.done")}
                </span>
                <span className="font-data tabular-nums">
                  {progress.done}/{progress.total} · {progress.fromCache} {t("misc.cachedBadge")}
                  {progress.errors > 0 ? ` · ${progress.errors} err` : ""}
                </span>
              </div>
              <ProgressBar value={progress.done} max={progress.total} />
            </div>
            {!analyzing && (
              <Button variant="primary" onClick={() => nav("/")}>
                {t("sources.goDashboard")} <ArrowRight size={13} />
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Mode 1: upload */}
      <Card title={t("sources.upload")}>
        <p className="mb-3 text-[12px] text-muted">{t("sources.uploadHint")}</p>
        <div
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setPending([...pending, ...[...e.dataTransfer.files].filter((f) => f.name.endsWith(".xlsx"))]);
          }}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong py-10 text-muted transition-colors hover:border-accent hover:text-ink"
        >
          <Upload size={20} strokeWidth={1.5} />
          <span className="text-[12.5px]">.xlsx</span>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".xlsx"
            className="hidden"
            onChange={(e) => setPending([...pending, ...[...(e.target.files ?? [])]])}
          />
        </div>
        {pending.length > 0 && (
          <div className="mt-3 flex flex-col gap-1">
            {pending.map((f, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-1.5 text-[12px]">
                <span className="truncate text-ink">{f.name}</span>
                <span className="ml-2 shrink-0 text-faint">{fileSize(f.size)}</span>
              </div>
            ))}
            <Button variant="primary" className="mt-2 self-start" onClick={() => void doUpload()} disabled={busy}>
              {t("sources.uploadBtn")} ({pending.length})
            </Button>
          </div>
        )}
      </Card>

      {/* Mode 2: folder scan */}
      <Card title={t("sources.scan")}>
        <p className="mb-3 text-[12px] text-muted">{t("sources.scanHint")}</p>
        <div className="flex flex-col gap-2.5">
          <Input
            placeholder="C:\Users\...\Teams\Field Actions"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
          {/* options avancées repliées par défaut — l'essentiel reste simple */}
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1 self-start text-[11.5px] font-medium text-muted hover:text-ink"
          >
            {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t("sources.advanced")}
          </button>
          {showAdvanced && (
            <div className="flex flex-col gap-2.5 rounded-xl bg-surface-2/60 p-3">
              <div className="grid grid-cols-2 gap-2.5">
                <Input
                  placeholder={t("sources.keywords")}
                  value={opts.keywords}
                  onChange={(e) => setOpts({ ...opts, keywords: e.target.value })}
                />
                <Input
                  placeholder={t("sources.countries")}
                  value={opts.countries}
                  onChange={(e) => setOpts({ ...opts, countries: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-4">
                <Checkbox
                  label={t("sources.subfolders")}
                  checked={opts.includeSubfolders}
                  onChange={(v) => setOpts({ ...opts, includeSubfolders: v })}
                />
                <label className="flex items-center gap-1.5 text-[12px] text-muted">
                  {t("sources.maxSize")}
                  <input
                    type="number"
                    value={opts.maxFileSizeMb}
                    onChange={(e) => setOpts({ ...opts, maxFileSizeMb: Number(e.target.value) })}
                    className="w-16 rounded-lg border border-line bg-surface px-2 py-1 text-ink outline-none focus:border-accent"
                  />
                </label>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void doPreview()} disabled={busy || !path}>
              <FolderSearch size={13} /> {t("sources.preview")}
            </Button>
            <Button variant="primary" onClick={() => void runScan(false)} disabled={busy || !path || analyzing}>
              {t("sources.analyzeChanged")}
            </Button>
            <Button onClick={() => void runScan(true)} disabled={busy || !path || analyzing}>
              {t("sources.forceAll")}
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                void (watchedPath
                  ? api.stopWatch().then(() => setWatchedPath(null))
                  : api.watch(path).then((s) => setWatchedPath(s.path)))
              }
              disabled={!path && !watchedPath}
            >
              <Radio size={13} /> {watchedPath ? t("sources.stopWatch") : t("sources.watch")}
            </Button>
          </div>

          {preview && (
            <div className="mt-1 rounded-xl border border-line bg-surface-2/50 p-3 text-[12px]">
              <div className="mb-2 font-medium text-ink">
                {preview.total} {t("sources.filesDetected")} —{" "}
                <span className="text-ok">{preview.cached} {t("sources.cached")}</span> ·{" "}
                <span className="text-warn">{preview.changed} {t("sources.changed")}</span>
              </div>
              <div className="flex max-h-44 flex-col gap-1 overflow-y-auto">
                {preview.files.map((f) => (
                  <div key={f.path} className="flex items-center justify-between gap-2">
                    <span className="truncate text-muted">{f.name}</span>
                    <span className={`shrink-0 rounded-full px-1.5 text-[10px] ${f.cached ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"}`}>
                      {f.cached ? t("sources.cached") : t("sources.changed")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Mode 3: library */}
      <Card title={t("sources.library")} className="xl:col-span-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-56">
            <Input
              placeholder={t("sources.folderLabel")}
              value={folderLabel}
              onChange={(e) => setFolderLabel(e.target.value)}
            />
          </div>
          <Button
            onClick={() =>
              void api
                .saveFolder(folderLabel || path, path, toApiOptions(opts))
                .then(() => {
                  setFolderLabel("");
                  loadFolders();
                })
            }
            disabled={!path}
          >
            <Star size={13} /> {t("sources.saveFolder")}
          </Button>
        </div>
        {folders.length > 0 && (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {folders.map((f) => (
              <div key={f.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/50 px-3 py-2">
                <button
                  className="flex-1 truncate text-left text-[12.5px] text-ink hover:text-accent"
                  title={f.path}
                  onClick={() => {
                    setPath(f.path);
                    try {
                      const o = JSON.parse(f.options_json ?? "{}");
                      setOpts({
                        includeSubfolders: o.includeSubfolders ?? true,
                        keywords: (o.keywords ?? []).join(", "),
                        countries: (o.countries ?? []).join(", "),
                        maxFileSizeMb: o.maxFileSizeMb ?? 100,
                      });
                    } catch { /* keep current */ }
                  }}
                >
                  <span className="font-medium">{f.label}</span>
                  <span className="ml-2 text-faint">{f.path}</span>
                </button>
                <button className="text-faint hover:text-bad" onClick={() => void api.deleteFolder(f.id).then(loadFolders)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
