/**
 * The classic handwriting recogniser (W11.H14) as an eval engine for
 * `npm run eval:public -- run ocr-handwriting-ivrit`: the app's cleaning
 * (src/ink/inkText.ts: grey → Otsu threshold → black on white) and then
 * Tesseract's Hebrew + English (tesseract.js, the app's OCR engine), on
 * this machine. ffmpeg decodes the image to grey (PGM); no network: the
 * traineddata comes from LUMEN_TESSDATA (a folder with heb.traineddata
 * and eng.traineddata, e.g. the one scripts/copy-tesseract.mjs stages).
 *
 *   LUMEN_TESSDATA=public/tesseract/lang npm run eval:public -- run ocr-handwriting-ivrit \
 *     --engine scripts/eval-public/engines/handwriting-tesseract.mjs --model tesseract-heb+eng --rev <tessdata sha>
 *
 * The verdict gate (handwritingExposed, ≤ 20 % median CER) decides whether
 * src/ink/inkRecognitionGate.json may open; this module only measures.
 */
import { spawnSync } from "node:child_process";

/** A binary PGM (P5, maxval 255) → { width, height, gray }. */
export function parsePgm(buf) {
  let pos = 0;
  const token = () => {
    while (pos < buf.length) {
      const c = buf[pos];
      if (c === 0x23) while (pos < buf.length && buf[pos] !== 0x0a) pos++;
      else if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) pos++;
      else break;
    }
    const s = pos;
    while (pos < buf.length && ![0x20, 0x0a, 0x0d, 0x09].includes(buf[pos])) pos++;
    return buf.subarray(s, pos).toString("latin1");
  };
  if (token() !== "P5") throw new Error("not a binary PGM (P5)");
  const width = Number(token());
  const height = Number(token());
  const max = Number(token());
  if (max !== 255) throw new Error(`PGM maxval ${max}: only 8-bit`);
  pos++;
  return { width, height, gray: buf.subarray(pos, pos + width * height) };
}

export function toPgm(width, height, gray) {
  return Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`, "latin1"), Buffer.from(gray)]);
}

/** Grey pixels → black on white by Otsu's threshold (`otsu` is the app's otsuThreshold). */
export function cleanGray(gray, otsu) {
  const t = otsu(gray);
  return Uint8Array.from(gray, (v) => (v <= t ? 0 : 255));
}

export async function makeHandwritingTesseract(env = process.env, deps = {}) {
  const tessdata = env.LUMEN_TESSDATA;
  if (!tessdata && !deps.ocr) throw new Error("set LUMEN_TESSDATA to a local folder with heb.traineddata and eng.traineddata");
  const { otsuThreshold } = deps.otsu ? { otsuThreshold: deps.otsu } : await (await import("tsx/esm/api")).tsImport("../../../src/ink/inkText.ts", import.meta.url);
  const decode =
    deps.decode ??
    ((path) => {
      const r = spawnSync("ffmpeg", ["-loglevel", "error", "-i", path, "-vf", "format=gray", "-f", "image2pipe", "-c:v", "pgm", "-"], { maxBuffer: 256 * 1024 * 1024 });
      if (r.status !== 0) throw new Error(`ffmpeg could not read ${path}: ${r.stderr}`);
      return r.stdout;
    });
  let ocr = deps.ocr;
  if (!ocr) {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker(["heb", "eng"], 1, { langPath: tessdata, cacheMethod: "none", gzip: false });
    ocr = async (pgm) => (await worker.recognize(pgm)).data.text;
  }
  return {
    id: "tesseract-heb+eng:clean-v1",
    async recognize(path) {
      const { width, height, gray } = parsePgm(decode(path));
      return String(await ocr(toPgm(width, height, cleanGray(gray, otsuThreshold)))).replace(/\s+/g, " ").trim();
    },
  };
}

export default async () => makeHandwritingTesseract();
