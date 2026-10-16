import { describe, it, expect } from "vitest";
import {
  bestTextOn,
  contrastRatio,
  hexToHslTriplet,
  hexToRgb,
  hslToRgb,
  isHexColor,
  meetsAA,
  meetsAAA,
  normalizeHex,
  relativeLuminance,
  rgbToHex,
  rgbToHsl,
} from "../lib/contrast";

describe("contrast helper", () => {
  it.each([
    ["#000000", "#ffffff", 21],
    ["#ffffff", "#ffffff", 1],
    ["#777777", "#ffffff", 4.48],
    ["#767676", "#ffffff", 4.54],
    ["#595959", "#ffffff", 7.0],
    ["#0000ff", "#ffffff", 8.59],
    ["#ff0000", "#ffffff", 4.0],
  ])("contrastRatio(%s, %s) ≈ %d", (a, b, expected) => {
    expect(contrastRatio(a, b)).toBeCloseTo(expected, 1);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#123456", "#fedcba")).toBeCloseTo(contrastRatio("#fedcba", "#123456"), 10);
  });

  it("relative luminance spans 0..1", () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 10);
  });

  it("AA/AAA thresholds", () => {
    expect(meetsAA(4.5)).toBe(true);
    expect(meetsAA(4.49)).toBe(false);
    expect(meetsAA(3, { large: true })).toBe(true);
    expect(meetsAAA(7)).toBe(true);
    expect(meetsAAA(6.9)).toBe(false);
    expect(meetsAAA(4.5, { large: true })).toBe(true);
  });

  it.each(["#fff", "#FFFFFF", "#a1b2c3", "#ABC"])("accepts %s", (v) => {
    expect(isHexColor(v)).toBe(true);
  });

  it.each(["fff", "#ffff", "#ggg", "red", "rgb(0,0,0)", "#fffffff", "", null, 12, "#fff;color:red"])(
    "rejects %s",
    (v) => {
      expect(isHexColor(v)).toBe(false);
    },
  );

  it("normalises short hex and throws on garbage", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(() => normalizeHex("blue")).toThrow();
  });

  it("round-trips hex ↔ rgb ↔ hsl", () => {
    for (const hex of ["#7c5cff", "#000000", "#ffffff", "#2e3440", "#ffd60a"]) {
      const { h, s, l } = rgbToHsl(hexToRgb(hex));
      expect(rgbToHex(hslToRgb(h, s, l))).toBe(hex);
    }
  });

  it("formats bare HSL triplets for CSS variables", () => {
    expect(hexToHslTriplet("#ffffff")).toBe("0 0% 100%");
    expect(hexToHslTriplet("#000000")).toBe("0 0% 0%");
    expect(hexToHslTriplet("#ff0000")).toBe("0 100% 50%");
  });

  it("bestTextOn picks the higher-contrast of black/white", () => {
    expect(bestTextOn("#ffd60a")).toBe("#000000");
    expect(bestTextOn("#0040c0")).toBe("#ffffff");
  });
});
