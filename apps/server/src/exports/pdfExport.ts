/**
 * Rapport PDF FieldPulse (pdfmake, Helvetica standard — offline) :
 * bandeau de titre, cartes KPI colorées, tableau des FA avec barres de
 * progression dessinées (canvas), Priority Focus encadré, détail optionnel.
 * Pensé pour être lu hors app par un manager.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import type { StoredSummary } from "../services/analyzer.js";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PdfPrinter: any = require("pdfmake");

const FONTS = {
  Helvetica: {
    normal: "Helvetica", bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique", bolditalics: "Helvetica-BoldOblique",
  },
};

/* palette rapport (thème clair premium de l'app) */
const C = {
  accent: "#2563eb", ink: "#101828", muted: "#667085", faint: "#98a2b3",
  line: "#e5e8ee", soft: "#f4f6fa",
  ok: "#059669", okSoft: "#e7f5ef",
  warn: "#ea580c", warnSoft: "#fdeee3",
  mid: "#b45309", midSoft: "#f8efdd",
  bad: "#dc2626", badSoft: "#fceaea",
};

const STATUS = {
  ready: { label: "Ready for Closure", color: C.ok, soft: C.okSoft },
  "waiting-forms": { label: "Waiting Forms/GFE", color: C.warn, soft: C.warnSoft },
  "waiting-reconciliation": { label: "Waiting Reconciliation", color: C.mid, soft: C.midSoft },
  blocked: { label: "Bloqué", color: C.bad, soft: C.badSoft },
  pending: { label: "En attente", color: C.muted, soft: C.soft },
} as Record<string, { label: string; color: string; soft: string }>;

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/** barre de progression dessinée (canvas pdfmake) */
const progressBar = (ratio: number | null, color = C.accent, w = 110) => ({
  canvas: [
    { type: "rect", x: 0, y: 3, w, h: 5, r: 2.5, color: C.line },
    ...(ratio !== null && ratio > 0
      ? [{ type: "rect", x: 0, y: 3, w: Math.max(4, w * Math.min(ratio, 1)), h: 5, r: 2.5, color }]
      : []),
  ],
  margin: [0, 2, 0, 0],
});

/** carte KPI colorée */
const kpiCard = (label: string, value: string, color: string, soft: string, sub?: string) => ({
  table: {
    widths: ["*"],
    body: [[{
      stack: [
        { text: value, fontSize: 22, bold: true, color, margin: [0, 2, 0, 1] },
        { text: label.toUpperCase(), fontSize: 6.5, color: C.muted, characterSpacing: 0.5 },
        ...(sub ? [{ text: sub, fontSize: 7, color: C.faint, margin: [0, 2, 0, 0] }] : []),
      ],
      fillColor: soft,
      margin: [10, 8, 10, 8],
      border: [false, false, false, false],
    }]],
  },
  layout: "noBorders",
});

export async function buildPdfExport(
  summaries: StoredSummary[],
  opts: { detailFaRef?: string; title?: string },
  outPath: string
): Promise<void> {
  const tot = (f: (s: StoredSummary) => number) => summaries.reduce((a, s) => a + f(s), 0);
  const count = (st: string) => summaries.filter((s) => s.closureStatus === st).length;
  const expected = tot((s) => s.kpis.expectedResponses);
  const answered = tot((s) => s.kpis.formsReceived + s.kpis.closedByGfe);
  const critical = summaries.filter((s) => s.critical).length;
  const now = new Date();

  const faRows = summaries
    .slice()
    .sort((a, b) => Number(b.critical) - Number(a.critical) || b.kpis.openResponses - a.kpis.openResponses)
    .map((s, i) => {
      const st = STATUS[s.closureStatus] ?? STATUS.pending;
      const fill = i % 2 ? C.soft : undefined;
      return [
        { text: `${s.critical ? "▲ " : ""}${s.faRef}`, bold: true, fontSize: 8, color: s.critical ? C.bad : C.ink, fillColor: fill },
        { text: s.deviceHint ?? "—", fontSize: 7.5, color: C.muted, fillColor: fill },
        { text: s.country ?? "—", fontSize: 7.5, fillColor: fill },
        { text: st.label, fontSize: 7.5, color: st.color, bold: true, fillColor: fill },
        {
          stack: [
            progressBar(s.kpis.completionRate, st.color === C.ok ? C.ok : C.accent),
            { text: `${s.kpis.formsReceived + s.kpis.closedByGfe}/${s.kpis.expectedResponses} · ${pct(s.kpis.completionRate)}`, fontSize: 6.5, color: C.faint, margin: [0, 2, 0, 0] },
          ],
          fillColor: fill,
        },
        { text: String(s.kpis.openResponses), fontSize: 8, alignment: "right", color: s.kpis.openResponses ? C.warn : C.faint, fillColor: fill },
        { text: String(s.kpis.qtyMissing), fontSize: 8, alignment: "right", color: s.kpis.qtyMissing ? C.mid : C.faint, fillColor: fill },
      ];
    });

  const priority = summaries
    .filter((s) => s.critical || s.closureStatus === "blocked" || s.kpis.openResponses > 0 || s.kpis.qtyMissing > 0)
    .sort((a, b) => Number(b.critical) - Number(a.critical) || b.kpis.openResponses - a.kpis.openResponses)
    .slice(0, 10)
    .map((s) => [
      { text: s.faRef, bold: true, fontSize: 8, color: C.ink },
      { text: s.deviceHint ?? "", fontSize: 7.5, color: C.muted },
      {
        text:
          s.closureStatus === "blocked"
            ? "Vérifier la structure du fichier source"
            : s.kpis.openResponses > 0
              ? `Relancer ${s.kpis.openResponses} client(s) sans formulaire`
              : s.kpis.qtyMissing > 0
                ? `Réconcilier ${s.kpis.qtyMissing} unité(s) manquante(s)`
                : "Prête — procéder à la clôture",
        fontSize: 8, color: C.ink,
      },
    ]);

  const content: unknown[] = [
    /* ---- bandeau de titre ---- */
    {
      table: {
        widths: ["*"],
        body: [[{
          stack: [
            { text: opts.title ?? "FieldPulse — Rapport Field Actions", fontSize: 17, bold: true, color: "#ffffff" },
            {
              text: `${now.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })} · ${summaries.length} Field Action(s) suivies · usage interne`,
              fontSize: 8, color: "#dbe6ff", margin: [0, 3, 0, 0],
            },
          ],
          fillColor: C.accent,
          margin: [14, 12, 14, 12],
          border: [false, false, false, false],
        }]],
      },
      layout: "noBorders",
      margin: [0, 0, 0, 12],
    },

    /* ---- cartes KPI ---- */
    {
      columns: [
        kpiCard("Avancement réponses", pct(expected ? answered / expected : null), C.accent, C.soft, `${answered}/${expected} formulaires`),
        kpiCard("Prêtes à clôturer", String(count("ready")), C.ok, C.okSoft),
        kpiCard("Réponses ouvertes", String(tot((s) => s.kpis.openResponses)), C.warn, C.warnSoft),
        kpiCard("Qté manquante", String(tot((s) => s.kpis.qtyMissing)), C.mid, C.midSoft),
        kpiCard("Critiques", String(critical), critical ? C.bad : C.ok, critical ? C.badSoft : C.okSoft),
      ],
      columnGap: 6,
      margin: [0, 0, 0, 14],
    },

    /* ---- tableau des FA ---- */
    { text: "Field Actions", fontSize: 11, bold: true, color: C.ink, margin: [0, 2, 0, 6] },
    {
      table: {
        headerRows: 1,
        widths: [52, "*", 38, 78, 120, 30, 36],
        body: [
          ["FA", "Dispositif", "Pays", "Statut", "Avancement", "Ouv.", "Qté mq."].map((h) => ({
            text: h, bold: true, fontSize: 7, color: C.muted, margin: [0, 2, 0, 2],
          })),
          ...faRows,
        ],
      },
      layout: {
        hLineColor: () => C.line, hLineWidth: (i: number) => (i <= 1 ? 0.7 : 0.4),
        vLineWidth: () => 0, paddingTop: () => 4, paddingBottom: () => 4,
      },
      margin: [0, 0, 0, 14],
    },

    /* ---- Priority Focus ---- */
    { text: "À traiter en priorité", fontSize: 11, bold: true, color: C.ink, margin: [0, 2, 0, 6] },
    priority.length
      ? {
          table: {
            widths: [52, 140, "*"],
            body: priority.map((row) => row.map((cell) => ({ ...cell, fillColor: C.warnSoft }))),
          },
          layout: {
            hLineColor: () => "#ffffff", hLineWidth: () => 2, vLineWidth: () => 0,
            paddingTop: () => 5, paddingBottom: () => 5, paddingLeft: () => 8, paddingRight: () => 8,
          },
        }
      : { text: "Rien de critique — tout est sous contrôle.", fontSize: 9, color: C.ok },
  ];

  /* ---- détail optionnel d'une FA ---- */
  if (opts.detailFaRef) {
    const s = summaries.find((x) => x.faRef === opts.detailFaRef);
    if (s) {
      const st = STATUS[s.closureStatus] ?? STATUS.pending;
      content.push(
        { text: `Détail — FA ${s.faRef}`, fontSize: 13, bold: true, color: C.ink, pageBreak: "before", margin: [0, 0, 0, 2] },
        { text: `${s.deviceHint ?? ""}${s.deviceHint ? " · " : ""}${st.label} · ${s.country ?? "—"}`, fontSize: 8, color: C.muted, margin: [0, 0, 0, 8] },
        {
          table: {
            headerRows: 1,
            widths: [48, "*", 62, 34, 34, 34, 90],
            body: [
              ["Sold To", "Établissement", "Statut", "À ret.", "Reçu", "Manq.", "Prochaine action"].map((t) => ({
                text: t, bold: true, fontSize: 6.5, color: C.muted,
              })),
              ...s.soldToSummaries.slice(0, 500).map((c, i) => {
                const fill = i % 2 ? C.soft : undefined;
                return [
                  { text: c.soldTo, fontSize: 7, fillColor: fill },
                  { text: c.hospitalName.slice(0, 48), fontSize: 7, fillColor: fill },
                  { text: c.formStatus, fontSize: 7, color: c.formStatus === "received" ? C.ok : c.formStatus === "open" ? C.warn : C.muted, fillColor: fill },
                  { text: String(c.qtyToReturn), fontSize: 7, alignment: "right", fillColor: fill },
                  { text: String(c.qtyReceived), fontSize: 7, alignment: "right", fillColor: fill },
                  { text: String(c.qtyMissing), fontSize: 7, alignment: "right", color: c.qtyMissing ? C.mid : C.faint, fillColor: fill },
                  { text: c.nextAction, fontSize: 6.5, color: C.muted, fillColor: fill },
                ];
              }),
            ],
          },
          layout: {
            hLineColor: () => C.line, hLineWidth: (i: number) => (i <= 1 ? 0.7 : 0.3),
            vLineWidth: () => 0, paddingTop: () => 3, paddingBottom: () => 3,
          },
        }
      );
    }
  }

  const printer = new PdfPrinter(FONTS);
  const doc = printer.createPdfKitDocument({
    content,
    defaultStyle: { font: "Helvetica", fontSize: 9, color: C.ink },
    pageMargins: [32, 30, 32, 34],
    footer: (page: number, pages: number) => ({
      columns: [
        { text: "FieldPulse · rapport généré localement — données internes", fontSize: 6.5, color: C.faint },
        { text: `${page} / ${pages}`, alignment: "right", fontSize: 6.5, color: C.faint },
      ],
      margin: [32, 10, 32, 0],
    }),
  });

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);
    doc.end();
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
}
