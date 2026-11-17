// @vitest-environment node
/**
 * W10.E45 (plan W2.19 step 1): LAN discovery on iOS and Android, behind the
 * same seam as the desktop. The plugin here is a stand-in for the native code,
 * with the shapes LumenLanPlugin.java / LanDiscovery.swift return. The seam,
 * discovery.ts' checks and the project wiring are the real code and files.
 * The native build is the owner's (Mac).
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { isLanHost } from "../sync/e2ee/lan/address";
import { capacitorInvoke, nativeLanAvailable, type LumenLanPlugin } from "../sync/e2ee/lan/nativeDiscovery";
import { announcePairing, discoveryAvailable, findDevices, joinFound, DiscoveryError } from "../sync/e2ee/lan/discovery";

const ROOT = resolve(__dirname, "..", "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const OFFER = "lumen-lan:1:offerFromHost_1";
const ANSWER = "lumen-lan:1:answerFromPeer_2";
// JUnit 4 for the Android unit test, where a JDK and Gradle's own JUnit are installed (LUMEN_JUNIT_DIR to point elsewhere).
const JUNIT_DIR = process.env.LUMEN_JUNIT_DIR ?? "/opt/gradle-8.14.3/lib";
const JUNIT = join(JUNIT_DIR, "junit-4.13.2.jar");
const HAMCREST = join(JUNIT_DIR, "hamcrest-core-1.3.jar");
const hasJavac = spawnSync("javac", ["-version"]).status === 0 && existsSync(JUNIT) && existsSync(HAMCREST);

function fakePlugin() {
  const calls: string[] = [];
  let answer: string | null = null;
  const p: LumenLanPlugin = {
    host: async (o) => (calls.push(`host ${o.offer}`), { name: "Lumen-K7Q2" }),
    answer: async () => (calls.push("answer"), { answer }),
    stop: async () => void calls.push("stop"),
    browse: async (o) => (calls.push(`browse ${o.ms}`), { devices: [{ name: "Lumen-K7Q2", host: "192.168.1.20", port: 40404 }, { name: "Lumen-AAAA", host: "8.8.8.8", port: 1 }, { name: "evil", host: "192.168.1.21", port: 2 }] }),
    fetchOffer: async (o) => (calls.push(`fetch ${o.host}:${o.port}`), { token: "0123456789abcdef0123456789abcdef", offer: OFFER }),
    sendAnswer: async (o) => {
      calls.push(`send ${o.token} ${o.answer}`);
      if (o.answer !== ANSWER) throw new Error("token");
    },
  };
  return { p, calls, deliver: (a: string) => (answer = a) };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("mobile LAN discovery seam (W10.E45)", () => {
  it("is available in the iOS / Android app only (Capacitor native platform with the LumenLan plugin)", () => {
    expect(nativeLanAvailable()).toBe(false);
    (globalThis as { window?: unknown }).window = { Capacitor: { isNativePlatform: () => true, isPluginAvailable: (n: string) => n === "LumenLan" } };
    expect(nativeLanAvailable()).toBe(true);
    expect(discoveryAvailable()).toBe(true);
    (globalThis as { window?: unknown }).window = { Capacitor: { isNativePlatform: () => false } };
    expect(nativeLanAvailable()).toBe(false);
  });

  it("the desktop commands run on the plugin, and discovery.ts still checks every name, address and code", async () => {
    const f = fakePlugin();
    const invoke = capacitorInvoke(f.p);
    const ctl = new AbortController();
    f.deliver(ANSWER); // the joining device has answered by the first poll
    const hosting = await announcePairing(OFFER, { signal: ctl.signal, invoke, pollMs: 5 });
    expect(hosting.name).toBe("Lumen-K7Q2");
    expect(await hosting.answer).toBe(ANSWER);
    const found = await findDevices({ invoke, ms: 1200 });
    expect(found).toEqual([{ name: "Lumen-K7Q2", host: "192.168.1.20", port: 40404 }]);
    const joined = await joinFound(found[0], async (offer) => (expect(offer).toBe(OFFER), { code: ANSWER }), { invoke });
    expect(joined.code).toBe(ANSWER);
    expect(f.calls).toEqual([`host ${OFFER}`, "answer", "browse 1200", "fetch 192.168.1.20:40404", `send 0123456789abcdef0123456789abcdef ${ANSWER}`]);
  });

  it("the plugin's refusals become discovery.ts' reasons, as Tauri's do; an expired offer ends the wait", async () => {
    const f = fakePlugin();
    f.p.sendAnswer = async () => {
      throw new Error("used");
    };
    await expect(joinFound({ name: "Lumen-K7Q2", host: "192.168.1.20", port: 1 }, async () => ({ code: ANSWER }), { invoke: capacitorInvoke(f.p) })).rejects.toMatchObject({ reason: "used" });
    f.p.answer = async () => ({ answer: null, expired: true });
    const h = await announcePairing(OFFER, { signal: new AbortController().signal, invoke: capacitorInvoke(f.p), pollMs: 5 });
    expect(await h.answer).toBeNull();
    await expect(capacitorInvoke(f.p)("lan_nope")).rejects.toThrow(/unknown command/);
    expect(new DiscoveryError("used").reason).toBe("used");
  });
});

describe("the native halves are in the projects, with the desktop's protocol (W10.E45)", () => {
  const rust = read("src-tauri/lan-mdns/src/lib.rs");
  const java = read("android/app/src/main/java/com/lumen/editor/LanRendezvous.java");
  const plugin = read("android/app/src/main/java/com/lumen/editor/LumenLanPlugin.java");
  const swift = read("ios/App/App/LanDiscovery.swift");

  it("the same service, protocol, code prefix, offer lifetime and name pattern as src-tauri/lan-mdns", () => {
    expect(rust).toContain('pub const SERVICE: &str = "_lumen-lan._tcp.local";');
    expect(rust).toContain('pub const PROTOCOL: &str = "LUMEN-LAN/1";');
    expect(rust).toContain('pub const CODE_PREFIX: &str = "lumen-lan:1:";');
    expect(rust).toContain("pub const OFFER_TTL: Duration = Duration::from_secs(5 * 60);");
    for (const src of [java, swift]) {
      expect(src).toMatch(/"LUMEN-LAN\/1"/);
      expect(src).toMatch(/"_lumen-lan\._tcp"/);
      expect(src).toMatch(/"lumen-lan:1:"/);
      expect(src).toContain("ABCDEFGHJKMNPQRSTVWXYZ23456789");
      for (const reply of ['"ERR used"', '"ERR token"', '"ERR bad"', '"OK"']) expect(src).toContain(reply);
    }
    expect(java).toContain("5 * 60 * 1000");
    expect(swift).toContain("5 * 60");
  });

  it("the same peers as the desktop: the Rust host's address cases hold for address.ts, and the Android test checks every one of them", () => {
    // The vectors of src-tauri/lan-mdns's the_local_network_rule_matches_address_ts.
    const block = rust.slice(rust.indexOf("fn the_local_network_rule_matches_address_ts"));
    const list = (kind: "ok" | "no") => [...(new RegExp(`for ${kind} in \\[([^\\]]*)\\]`).exec(block)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const ok = list("ok");
    const no = list("no");
    expect(ok.length).toBeGreaterThan(5);
    expect(no).toContain("100.64.0.1");
    for (const a of ok) expect(isLanHost(a), a).toBe(true);
    for (const a of no) expect(isLanHost(a), a).toBe(false);
    const junit = read("android/app/src/test/java/com/lumen/editor/LanRendezvousTest.java");
    for (const a of [...ok, ...no]) expect(junit, a).toContain(`"${a}"`);
    // Carrier-grade NAT (100.64/10) is refused on the phones too (W2.19: a carrier's network is not the user's).
    for (const src of [java, swift]) {
      expect(src).not.toMatch(/== 100 && \(b\[1\] & 0xc0\) == 64/);
      expect(src).not.toMatch(/isSiteLocalAddress\(\)/);
    }
    expect(swift).toContain("isLanV4(Array(b[12..<16]))");
  });

  it.skipIf(!hasJavac)("the Android rendezvous passes its JUnit test (plain javac and JUnit 4)", () => {
    const out = mkdtempSync(join(tmpdir(), "lumen-lan-junit-"));
    try {
      const cp = [JUNIT, HAMCREST].join(":");
      const c = spawnSync("javac", ["-d", out, "-cp", cp, "android/app/src/main/java/com/lumen/editor/LanRendezvous.java", "android/app/src/test/java/com/lumen/editor/LanRendezvousTest.java"], { cwd: ROOT, encoding: "utf8" });
      expect(c.status, c.stderr).toBe(0);
      const r = spawnSync("java", ["-cp", `${out}:${cp}`, "org.junit.runner.JUnitCore", "com.lumen.editor.LanRendezvousTest"], { cwd: ROOT, encoding: "utf8" });
      expect(r.stdout, r.stdout + r.stderr).toMatch(/OK \(4 tests\)/);
      expect(r.status).toBe(0);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("Android registers the plugin as LumenLan, with NsdManager, and only after LumenNative", () => {
    expect(plugin).toContain('@CapacitorPlugin(name = "LumenLan")');
    expect(plugin).toContain("NsdManager.PROTOCOL_DNS_SD");
    const main = read("android/app/src/main/java/com/lumen/editor/MainActivity.java");
    expect(main.indexOf("registerPlugin(LumenLanPlugin.class)")).toBeGreaterThan(main.indexOf("registerPlugin(LumenNativePlugin.class)"));
    expect(main.indexOf("registerPlugin(LumenLanPlugin.class)")).toBeLessThan(main.indexOf("super.onCreate"));
  });

  it("iOS: the Swift file is in the App target's sources, the plugin is registered, and Info.plist declares the service and why", () => {
    const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
    expect(pbx).toMatch(/E45A00000000000000000002 \/\* LanDiscovery\.swift in Sources \*\/ = \{isa = PBXBuildFile; fileRef = E45A00000000000000000001/);
    const sources = pbx.slice(pbx.indexOf("/* Begin PBXSourcesBuildPhase section */"), pbx.indexOf("/* End PBXSourcesBuildPhase section */"));
    expect(sources).toContain("E45A00000000000000000002 /* LanDiscovery.swift in Sources */");
    expect(read("ios/App/App/LumenNative.swift")).toContain("bridge?.registerPluginInstance(LumenLanPlugin())");
    expect(swift).toContain('public let jsName = "LumenLan"');
    for (const m of ["host", "answer", "stop", "browse", "fetchOffer", "sendAnswer"]) {
      expect(swift).toContain(`CAPPluginMethod(name: "${m}"`);
      expect(plugin).toMatch(new RegExp(`public void ${m}\\(PluginCall call\\)`));
    }
    const plist = read("ios/App/App/Info.plist");
    expect(plist).toContain("<key>NSLocalNetworkUsageDescription</key>");
    expect(plist).toMatch(/<key>NSBonjourServices<\/key>\s*<array>\s*<string>_lumen-lan\._tcp<\/string>/);
  });
});
