/** T31 × T37 — OCR language models are downloaded in a worker; the ledger still records them. */
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { set, clear } from "idb-keyval";
import { __resetLedger, ledgerEntries } from "../ai/privacyLedger";
import { noteModelDownloads } from "../ai/ocr";

describe("OCR model downloads in the privacy ledger", () => {
  beforeEach(async () => {
    localStorage.clear();
    __resetLedger();
    await clear();
  });

  it("records each language model the worker will download on first use", async () => {
    await noteModelDownloads();
    const e = ledgerEntries();
    expect(e.map((x) => x.category)).toEqual(["model-download", "model-download"]);
    expect(e.every((x) => x.host === "raw.githubusercontent.com" && x.decision === "allowed")).toBe(true);
  });

  it("records nothing for models already in tesseract's cache", async () => {
    await set("./heb.traineddata", new Uint8Array([1]));
    await set("./eng.traineddata", new Uint8Array([1]));
    await noteModelDownloads();
    expect(ledgerEntries()).toHaveLength(0);
  });
});
