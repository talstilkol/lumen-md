/**
 * Plan W5.11: a photo added to a note loses its GPS position, time, device
 * and text metadata; its pixels and its orientation stay.
 * The fixtures are synthetic photos made with Pillow (see the JSON's "about").
 */
import { afterEach, describe, expect, it } from "vitest";
import fixtures from "./fixtures/gps-photos.json";
import { cleanImageFile, hasGps, KEEP_METADATA_KEY, stripImageMetadata } from "../lib/imageMetadata";

const images = Object.entries((fixtures as { images: Record<string, string> }).images).map(
  ([name, b64]) => [name, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))] as const,
);
const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");

afterEach(() => localStorage.removeItem(KEEP_METADATA_KEY));

describe("stripImageMetadata", () => {
  it("every fixture has GPS before and none after, in JPEG, PNG and WebP", () => {
    expect(images.map(([n]) => n.split(".")[1]).sort()).toEqual(["jpg", "jpg", "png", "png", "webp", "webp"]);
    for (const [name, bytes] of images) {
      expect(hasGps(bytes), name).toBe(true);
      const r = stripImageMetadata(bytes);
      expect(r.removed, name).toContain("GPS");
      expect(hasGps(r.bytes), name).toBe(false);
      const text = latin1(r.bytes);
      for (const leak of ["PhoneCo", "Reporter Name", "2026:11:12", "near the source"]) expect(text.includes(leak), `${name}: ${leak}`).toBe(false);
      // Running it again finds nothing more to take out.
      expect(stripImageMetadata(r.bytes).removed.filter((x) => x !== "EXIF"), name).toEqual([]);
    }
  });

  it("50 photos with GPS: 0 keep it", () => {
    let left = 0;
    for (let i = 0; i < 50; i++) {
      const [, bytes] = images[i % images.length];
      if (hasGps(stripImageMetadata(bytes).bytes)) left++;
    }
    expect(left).toBe(0);
  });

  it("a JPEG keeps its orientation (rotated photos stay upright) and everything from the scan on", () => {
    const [, rotated] = images.find(([n]) => n === "p03.jpg")!;
    const r = stripImageMetadata(rotated);
    // A minimal EXIF block with Orientation = 8 and nothing else.
    const exif = latin1(r.bytes).indexOf("Exif\0\0");
    expect(exif).toBeGreaterThan(0);
    expect(r.bytes[exif + 6 + 8 + 2 + 8 + 1]).toBe(8);
    const sos = (b: Uint8Array) => {
      for (let i = 2; i < b.length - 1; i++) if (b[i] === 0xff && b[i + 1] === 0xda) return i;
      return -1;
    };
    expect(Array.from(r.bytes.subarray(sos(r.bytes)))).toEqual(Array.from(rotated.subarray(sos(rotated))));
    // Orientation 1 needs no EXIF at all.
    const [, upright] = images.find(([n]) => n === "p00.jpg")!;
    expect(latin1(stripImageMetadata(upright).bytes).includes("Exif\0\0")).toBe(false);
  });

  it("a WebP stays a valid RIFF with its EXIF flag cleared", () => {
    const [, webp] = images.find(([n]) => n.endsWith(".webp"))!;
    const out = stripImageMetadata(webp).bytes;
    const size = out[4] | (out[5] << 8) | (out[6] << 16) | (out[7] << 24);
    expect(size).toBe(out.length - 8);
    const vp8x = latin1(out).indexOf("VP8X");
    if (vp8x >= 0) expect(out[vp8x + 8] & 0x0c).toBe(0);
  });

  it("leaves other formats and damaged files unchanged", () => {
    const gif = new TextEncoder().encode("GIF89a\x01\x00\x01\x00");
    expect(stripImageMetadata(gif)).toMatchObject({ format: null, removed: [] });
    const cut = images[0][1].subarray(0, 40);
    expect(Array.from(stripImageMetadata(cut).bytes)).toEqual(Array.from(cut));
  });
});

describe("cleanImageFile (what the editor stores)", () => {
  it("removes metadata by default, keeps the name and type", async () => {
    const [name, bytes] = images[0];
    const out = await cleanImageFile(new File([bytes], name, { type: "image/jpeg" }));
    expect(out.name).toBe(name);
    expect(out.type).toBe("image/jpeg");
    expect(hasGps(new Uint8Array(await out.arrayBuffer()))).toBe(false);
  });

  it("keeps it when the user chose to", async () => {
    localStorage.setItem(KEEP_METADATA_KEY, "1");
    const [name, bytes] = images[0];
    const file = new File([bytes], name, { type: "image/jpeg" });
    expect(await cleanImageFile(file)).toBe(file);
  });
});
