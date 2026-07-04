/**
 * Génère build/icon.png (512×512) sans dépendance : PNG écrit à la main
 * (zlib.deflateSync). Logo FACM : carré arrondi bleu #1E40AF, barres
 * blanches formant un "F" stylisé façon graphique de dashboard.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const S = 512;

/* ---- raster RGBA ---- */
const px = new Uint8Array(S * S * 4);
const put = (x, y, r, g, b, a = 255) => {
  const i = (y * S + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
};

const inRounded = (x, y, x0, y0, x1, y1, rad) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + rad, Math.min(x, x1 - rad));
  const cy = Math.max(y0 + rad, Math.min(y, y1 - rad));
  return (x - cx) ** 2 + (y - cy) ** 2 <= rad ** 2 || (x >= x0 + rad && x <= x1 - rad) || (y >= y0 + rad && y <= y1 - rad);
};

// fond : carré arrondi, dégradé vertical #1E40AF -> #3B82F6
for (let y = 0; y < S; y++) {
  const t = y / S;
  const r = Math.round(0x1e + (0x3b - 0x1e) * t);
  const g = Math.round(0x40 + (0x82 - 0x40) * t);
  const b = Math.round(0xaf + (0xf6 - 0xaf) * t);
  for (let x = 0; x < S; x++) {
    if (inRounded(x, y, 16, 16, S - 17, S - 17, 96)) put(x, y, r, g, b);
    else put(x, y, 0, 0, 0, 0);
  }
}

// "F" en barres de dashboard (blanches, coins arrondis légers)
const bar = (x0, y0, x1, y1) => {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (inRounded(x, y, x0, y0, x1, y1, 14)) put(x, y, 255, 255, 255);
};
bar(150, 128, 210, 384); // montant vertical
bar(150, 128, 372, 188); // barre haute (longue)
bar(150, 236, 322, 296); // barre médiane (moyenne)
// point "statut" ambre en bas à droite — clin d'œil aux badges
for (let y = 320; y < 384; y++)
  for (let x = 308; x < 372; x++)
    if ((x - 340) ** 2 + (y - 352) ** 2 <= 30 ** 2) put(x, y, 245, 158, 11);

/* ---- encodage PNG minimal ---- */
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filtre none
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const dest = path.join(ROOT, "build", "icon.png");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, png);
console.log(`✔ ${dest} (${Math.round(png.length / 1024)} Ko)`);
