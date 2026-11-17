/**
 * W13.R14: the reading study's protocol and scoring. The study itself is
 * the owner's (6 readers, 2 with dyslexia: scripts/owner/steps.mjs,
 * devices/reading-study); here: the protocol is balanced, a session sheet is
 * validated, and the keep/drop rule for the experimental modes works on
 * both sides of its thresholds.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs script without type declarations
import { blank, decide, loadProtocol, status, summarize, validateSession } from "../../scripts/owner/readingStudy.mjs";

type Reading = { mode: string; passage: string; seconds: number; answers: number[]; preference: number };
type Session = { reader: string; dyslexia: boolean; readings: Reading[] };
type Proto = { readers: number; modes: Array<{ id: string }>; passages: Array<{ id: string; questions: Array<{ answer: number; options: string[] }> }>; order: Array<Array<{ mode: string; passage: string }>>; decisionRule: { experimental: string[] } };

const protocol = loadProtocol() as Proto;

/** A session: every answer right except `wrong[mode]` wrong ones; preference by mode. */
function session(reader: string, slot: number, dyslexia: boolean, wrong: Record<string, number> = {}, pref: Record<string, number> = {}): Session {
  return {
    reader,
    dyslexia,
    readings: protocol.order[slot].map(({ mode, passage }) => {
      const p = protocol.passages.find((x) => x.id === passage)!;
      const answers = p.questions.map((q, i) => (i < (wrong[mode] ?? 0) ? (q.answer + 1) % q.options.length : q.answer));
      return { mode, passage, seconds: 40 + slot, answers, preference: pref[mode] ?? 4 };
    }),
  };
}

describe("the protocol", () => {
  it("6 modes, 6 invented passages with 3 questions each, the two experimental modes named", () => {
    expect(protocol.modes.map((m) => m.id)).toEqual(["baseline", "focus", "rsvp", "anchor", "immersive", "page-view"]);
    expect(protocol.passages).toHaveLength(6);
    for (const p of protocol.passages) {
      expect(p.questions).toHaveLength(3);
      for (const q of p.questions) expect(q.answer).toBeLessThan(q.options.length);
    }
    expect(protocol.decisionRule.experimental).toEqual(["rsvp", "anchor"]);
  });
  it("a Latin square: each reader meets every mode and passage once; each position has every mode once", () => {
    expect(protocol.order).toHaveLength(6);
    for (const row of protocol.order) {
      expect(new Set(row.map((r) => r.mode)).size).toBe(6);
      expect(new Set(row.map((r) => r.passage)).size).toBe(6);
    }
    for (let k = 0; k < 6; k++) expect(new Set(protocol.order.map((row) => row[k].mode)).size).toBe(6);
    // And each mode meets every passage across the readers (no mode tied to an easy text).
    for (const m of protocol.modes) expect(new Set(protocol.order.map((row) => row.find((r) => r.mode === m.id)!.passage)).size).toBe(6);
  });
});

describe("sessions", () => {
  it("a complete sheet is valid; a blank one lists what is missing", () => {
    expect(validateSession(session("r1", 0, false), protocol)).toEqual([]);
    const b = blank(protocol, "r2", true, 1);
    expect(b.readings.map((r: Reading) => r.mode)).toEqual(protocol.order[1].map((o) => o.mode));
    expect(validateSession(b, protocol).length).toBeGreaterThan(0);
    expect(validateSession({ ...session("Tal Cohen", 0, false) }, protocol)).toContain("reader: a short pseudonymous id");
  });
});

describe("the decision rule", () => {
  const six = (wrong: Record<string, number>, pref: Record<string, number> = {}, dysWrong: Record<string, number> = wrong) =>
    [0, 1, 2, 3, 4, 5].map((i) => session(`r${i + 1}`, i, i < 2, i < 2 ? dysWrong : wrong, pref)).map((s) => ({ file: `${s.reader}.json`, session: s }));

  it("keeps a mode that matches the baseline and is liked", () => {
    const st = status(six({}), protocol);
    expect(st.done).toBe(true);
    expect(st.decisions).toEqual({ rsvp: { decision: "keep", why: expect.any(String) }, anchor: { decision: "keep", why: expect.any(String) } });
  });
  it("drops RSVP when comprehension falls more than 10 points (the backtracking finding)", () => {
    const st = status(six({ rsvp: 1 }), protocol);
    expect(st.decisions.rsvp.decision).toBe("drop");
    expect(st.decisions.rsvp.why).toMatch(/comprehension 66.7% < baseline 100% − 10/);
    expect(st.decisions.anchor.decision).toBe("keep");
  });
  it("drops a mode readers do not like (median preference below 3)", () => {
    expect(status(six({}, { anchor: 2 }), protocol).decisions.anchor.decision).toBe("drop");
  });
  it("drops a mode that hurts the dyslexic readers even when the others are fine", () => {
    const st = status(six({}, {}, { anchor: 2 }), protocol);
    expect(st.decisions.anchor.why).toMatch(/dyslexic readers/);
  });
  it("is not done with five sessions, or with one dyslexic reader", () => {
    expect(status(six({}).slice(1), protocol).done).toBe(false);
    const oneDys = six({}).map((e, i) => (i === 1 ? { ...e, session: { ...e.session, dyslexia: false } } : e));
    expect(status(oneDys, protocol).done).toBe(false);
  });
  it("summary: median seconds, comprehension and preference per mode", () => {
    const s = summarize(six({}).map((e) => e.session), protocol);
    expect(s.baseline.all).toEqual({ n: 6, seconds: 42.5, comprehension: 100, preference: 4 });
    expect(s.baseline.dyslexia.n).toBe(2);
    expect(decide(s, protocol).rsvp.decision).toBe("keep");
  });
});
