/**
 * W10.E52 (plan W7.10 step 2): the in-app corpus recorder. It loads the
 * script, asks for consent, checks every take with corpus.checkTake and
 * exports the ZIP that `kit.mjs check` and Piper's trainer read.
 *
 * The audio is SYNTHETIC (a tone in low noise, and a clipped one), made in
 * the test. The microphone is the one seam (`startCapture`). The check, the
 * session and the ZIP are the real code.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { crc32 as zlibCrc32 } from "node:zlib";
import { CorpusRecorder, type RecorderDeps } from "../voice-corpus/Recorder";
import { CORPUS_RATE, addTake, exportFiles, newSession, nextSentence, parseScript } from "../voice-corpus/session";
import { crc32, storedZip } from "../voice-corpus/zipStore";

/** `seconds` of a 220 Hz tone at `amp`, with 0.3 s of quiet noise (−70 dBFS) on each side. */
function take(amp: number, seconds = 1.5, rate = CORPUS_RATE): Float32Array {
  const pad = Math.round(0.3 * rate);
  const n = Math.round(seconds * rate) + 2 * pad;
  const out = new Float32Array(n);
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.0006;
  for (let i = 0; i < n; i++) out[i] = noise() + (i >= pad && i < n - pad ? Math.max(-1, Math.min(1, amp * Math.sin((2 * Math.PI * 220 * i) / rate))) : 0);
  return out;
}

/** The ZIP's entries, read back by its own structures (central directory → local headers). */
function unzip(zip: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  let o = v.getUint32(end + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(o, true)).toBe(0x02014b50);
    const crc = v.getUint32(o + 16, true);
    const size = v.getUint32(o + 24, true);
    const nameLen = v.getUint16(o + 28, true);
    const name = new TextDecoder().decode(zip.subarray(o + 46, o + 46 + nameLen));
    const local = v.getUint32(o + 42, true);
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    expect(v.getUint16(local + 8, true)).toBe(0); // stored
    const data = zip.subarray(local + 30 + v.getUint16(local + 26, true), local + 30 + v.getUint16(local + 26, true) + size);
    expect(crc32(data)).toBe(crc);
    out.set(name, data);
    o += 46 + nameLen + v.getUint16(o + 30, true) + v.getUint16(o + 32, true);
  }
  return out;
}

const SCRIPT = "s1\tהספר מונח על השולחן\tcommonvoice\ns2\tהיום יום יפה\tbenyehuda\n\ns2\tduplicate\tx\nbad line\n";

describe("voice corpus session (W10.E52)", () => {
  it("parses the kit's script.tsv; blank, duplicate and malformed lines are skipped", () => {
    expect(parseScript(SCRIPT)).toEqual([
      { id: "s1", text: "הספר מונח על השולחן", source: "commonvoice" },
      { id: "s2", text: "היום יום יפה", source: "benyehuda" },
    ]);
  });

  it("no take before consent; a take is checked by corpus.checkTake; the next sentence skips good takes", () => {
    const s = newSession(parseScript(SCRIPT));
    expect(() => addTake(s, "s1", take(0.1), CORPUS_RATE)).toThrow(/consent/);
    s.consent = { version: "v", speaker: "Dana", at: "2026-11-15T00:00:00.000Z", licence: "CC0-1.0" };
    const good = addTake(s, "s1", take(0.1), CORPUS_RATE);
    expect(good.check.ok).toBe(true);
    expect(nextSentence(s)?.id).toBe("s2");
    const clipped = addTake(s, "s2", take(1.4), CORPUS_RATE);
    expect(clipped.check.ok).toBe(false);
    expect(clipped.check.problems).toContain("clipping");
    expect(nextSentence(s, "s2")?.id).toBe("s2");
    expect(() => addTake(s, "nope", take(0.1), CORPUS_RATE)).toThrow(/not in the script/);
  });

  it("the export: script.tsv, LJSpeech metadata of the passing takes only, WAVs, and a manifest with the consent", () => {
    const s = newSession(parseScript(SCRIPT));
    s.consent = { version: "2026-11-15-draft", speaker: "Dana", at: "2026-11-15T00:00:00.000Z", licence: "CC0-1.0" };
    addTake(s, "s1", take(0.1), CORPUS_RATE);
    addTake(s, "s2", take(1.4), CORPUS_RATE);
    const files = unzip(storedZip(exportFiles(s)));
    expect([...files.keys()]).toEqual(["script.tsv", "metadata.csv", "manifest.json", "wavs/s1.wav", "wavs/s2.wav"]);
    const text = (p: string) => new TextDecoder().decode(files.get(p));
    expect(text("metadata.csv")).toBe("s1|הספר מונח על השולחן|הספר מונח על השולחן\n");
    expect(text("script.tsv").split("\n")[0]).toBe("s1\tהספר מונח על השולחן\tcommonvoice");
    const m = JSON.parse(text("manifest.json"));
    expect(m).toMatchObject({ format: "lumen-voice-corpus/1", rate: 22050, licence: "CC0-1.0", consent: { speaker: "Dana", version: "2026-11-15-draft" }, summary: { takes: 2, ok: 1 } });
    expect(m.takes.map((t: { id: string; ok: boolean }) => [t.id, t.ok])).toEqual([["s1", true], ["s2", false]]);
    const w = files.get("wavs/s1.wav")!;
    const v = new DataView(w.buffer, w.byteOffset, w.byteLength);
    expect(new TextDecoder().decode(w.subarray(0, 4))).toBe("RIFF");
    expect(v.getUint32(24, true)).toBe(22050);
    expect(v.getUint16(34, true)).toBe(16);
  });

  it("the ZIP's CRC-32 is zlib's", () => {
    for (const s of ["", "a", "שלום", "x".repeat(70_000)]) {
      const b = new TextEncoder().encode(s);
      expect(crc32(b)).toBe(zlibCrc32(b));
    }
  });
});

describe("the recorder component (W10.E52)", () => {
  it("script → consent → record → check → retake → export, with corpus.ts doing the check", async () => {
    const takes = [take(1.4), take(0.1)];
    const saved: Array<{ name: string; bytes: Uint8Array }> = [];
    const deps: RecorderDeps = {
      startCapture: vi.fn(async () => ({ stop: async () => ({ samples: takes.shift()!, rate: CORPUS_RATE }) })),
      save: (name, bytes) => saved.push({ name, bytes }),
      now: () => new Date("2026-11-15T10:00:00Z"),
    };
    const { getByTestId, queryByTestId } = render(<CorpusRecorder onClose={() => undefined} deps={deps} />);
    const file = new File([SCRIPT], "script.tsv", { type: "text/tab-separated-values" });
    fireEvent.change(getByTestId("voice-corpus-script"), { target: { files: [file] } });
    await waitFor(() => expect(getByTestId("voice-corpus-consent")).toBeTruthy());
    expect(queryByTestId("voice-corpus-record")).toBeNull();
    expect((getByTestId("voice-corpus-consent-ok") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(getByTestId("voice-corpus-speaker"), { target: { value: "Dana" } });
    fireEvent.click(getByTestId("voice-corpus-agree"));
    fireEvent.click(getByTestId("voice-corpus-consent-ok"));
    await waitFor(() => expect(getByTestId("voice-corpus-sentence").textContent).toBe("הספר מונח על השולחן"));

    fireEvent.click(getByTestId("voice-corpus-record"));
    await waitFor(() => expect(getByTestId("voice-corpus-stop")).toBeTruthy());
    fireEvent.click(getByTestId("voice-corpus-stop"));
    await waitFor(() => expect(getByTestId("voice-corpus-check").getAttribute("data-ok")).toBe("false"));
    expect(getByTestId("voice-corpus-check").textContent).toContain("clipping");

    fireEvent.click(getByTestId("voice-corpus-record"));
    await waitFor(() => expect(getByTestId("voice-corpus-stop")).toBeTruthy());
    fireEvent.click(getByTestId("voice-corpus-stop"));
    await waitFor(() => expect(getByTestId("voice-corpus-check").getAttribute("data-ok")).toBe("true"));

    fireEvent.click(getByTestId("voice-corpus-export"));
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("lumen-voice-corpus-2026-11-15.zip");
    const files = unzip(saved[0].bytes);
    expect([...files.keys()]).toEqual(["script.tsv", "metadata.csv", "manifest.json", "wavs/s1.wav"]);
    expect(JSON.parse(new TextDecoder().decode(files.get("manifest.json"))).consent).toMatchObject({ speaker: "Dana", at: "2026-11-15T10:00:00.000Z", licence: "CC0-1.0" });
    expect(deps.startCapture).toHaveBeenCalledTimes(2);
  });
});
