/** Settings: language, theme, critical deadline, debug toggle, cache. */
import { useEffect, useState } from "react";
import { api } from "../api";
import { useAppStore } from "../store";
import { useT, type Lang } from "../i18n";
import { Button, Card, Checkbox, Input, Select } from "../components/ui";

export function SettingsPage() {
  const t = useT();
  const { lang, setLang, theme, setTheme, debug, setDebug, deadlineDays, setDeadlineDays, toast, refreshResults } =
    useAppStore();
  const [stats, setStats] = useState<{ files: number; analyses: number; runs: number } | null>(null);

  const loadStats = () => void api.cacheStats().then(setStats).catch(() => {});
  useEffect(loadStats, []);

  const save = async () => {
    await api.saveSettings({ language: lang, deadlineDays, debug });
    toast("success", t("set.saved"));
  };

  return (
    <div className="grid max-w-2xl gap-4">
      <Card title={t("set.title")}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] text-muted">{t("set.language")}</span>
            <Select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] text-muted">{t("set.theme")}</span>
            <Select value={theme} onChange={(e) => setTheme(e.target.value as "dark" | "light")}>
              <option value="dark">{t("set.dark")}</option>
              <option value="light">{t("set.light")}</option>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-[12.5px] text-muted">{t("set.deadline")}</span>
            <div className="w-24">
              <Input
                type="number"
                value={deadlineDays}
                onChange={(e) => setDeadlineDays(Number(e.target.value))}
              />
            </div>
          </div>
          <Checkbox label={t("set.debug")} checked={debug} onChange={setDebug} />
          <Button variant="primary" className="self-start" onClick={() => void save()}>
            {t("set.save")}
          </Button>
        </div>
      </Card>

      <Card title={t("set.cache")}>
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] text-muted">
            {stats ? `${stats.files} ${t("set.cacheStats", { a: stats.analyses, r: stats.runs })}` : "…"}
          </span>
          <Button
            variant="danger"
            onClick={() =>
              void api.clearCache().then(() => {
                loadStats();
                void refreshResults();
                toast("info", t("sources.clearCache"));
              })
            }
          >
            {t("sources.clearCache")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
