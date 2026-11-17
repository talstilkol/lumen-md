/**
 * W13.X5 — lumen:// links and unknown file types. A link that writes or
 * opens asks first (desktop: new, capture, open; mobile: capture with text;
 * any platform: a clip from a link or an address); a link from a foreign
 * page writes nothing without the user's yes; "always allow from this
 * source" stays on this device and never travels with settings or sync; an
 * unknown or dangerous file type asks every time, with a warning; every
 * decision is in the privacy ledger.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import { ALLOW_KEY, allowedSources, allowSource, confirmLink, decideLink, fileRisk, forgetSource, htmlLoadsNetwork, ledgerLine, recordLinkDecision, type LinkAction } from "../security/linkConfirm";
import { handleOpenRequest, type OpenDeps } from "../desktop/shell";
import { applyAction, parseNativeUrl, type NativeHandlers } from "../mobile/nativeActions";
import { startClipBridge } from "../research/clipBridge";
import { exportSettings, importSettings, type SettingsTarget } from "../settings/io";
import { SETTINGS } from "../settings/schema";
import { __resetLedger, ledgerEntries } from "../ai/privacyLedger";
import { LinkConfirmDialog } from "../security/LinkConfirmDialog";

function mem(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

describe("what a link would do", () => {
  it("moving around does not ask; writing and opening do", () => {
    expect(decideLink({ kind: "nav", what: "search" }).ask).toBe(false);
    expect(decideLink({ kind: "new-note", title: null, text: null, folder: null }).ask).toBe(false);
    expect(decideLink({ kind: "new-note", title: "רעיון", text: "x", folder: null })).toMatchObject({ ask: true, source: "link:new", risk: "write", describe: { key: "link.confirm.new", values: { title: "רעיון", text: "x", folder: "—" } } });
    expect(decideLink({ kind: "capture", text: "לקנות חלב" })).toMatchObject({ ask: true, source: "link:capture" });
    expect(decideLink({ kind: "clip", pageUrl: "https://news.example/a?b=1", title: "T" })).toMatchObject({ ask: true, source: "clip:https://news.example" });
    expect(decideLink({ kind: "clip", pageUrl: "javascript:alert(1)", title: "T" }).source).toBeNull();
    expect(decideLink({ kind: "open-file", path: "notes/a.md" })).toMatchObject({ ask: true, source: "link:open", warning: null });
  });

  it("file types: notes and known viewers; programs, scripts, local HTML and unknown types warn and are never remembered", () => {
    const cases: [string, string | null, string][] = [
      ["a.md", null, "note"],
      ["paper.pdf", null, "known"],
      ["setup.exe", null, "executable"],
      ["Install.app", null, "executable"],
      ["run.sh", null, "script"],
      ["x.PS1", null, "script"],
      ["page.html", "<p>hi</p>", "html"],
      ["page.html", '<img src="https://tracker.example/p.gif">', "html-network"],
      ["page.htm", "<script>fetch('/x')</script>", "html-network"],
      ["thing.xyz", null, "unknown"],
      ["noext", null, "unknown"],
    ];
    for (const [p, html, want] of cases) expect(fileRisk(p, html), p).toBe(want);
    for (const p of ["setup.exe", "run.sh", "page.html", "thing.xyz"]) {
      const d = decideLink({ kind: "open-file", path: p, html: null });
      expect(d.warning, p).not.toBeNull();
      expect(d.source, p).toBeNull();
    }
    expect(htmlLoadsNetwork('<link rel="stylesheet" href="//cdn.example/x.css">')).toBe(true);
    expect(htmlLoadsNetwork('<a href="https://example.com">a link is not a load</a>')).toBe(false);
  });
});

describe("asking, remembering, recording", () => {
  it("no → nothing runs and nothing is remembered; yes + always → remembered for that source only", async () => {
    const store = mem();
    const ask = vi.fn(async () => ({ ok: false, always: true }));
    const rec: string[] = [];
    const record = (a: LinkAction, d: string, how: string) => void rec.push(`${ledgerLine(a)} ${d} ${how}`);
    expect(await confirmLink({ kind: "capture", text: "x" }, { ask, record, store })).toBe(false);
    expect(allowedSources(store)).toEqual({});
    ask.mockResolvedValueOnce({ ok: true, always: true });
    expect(await confirmLink({ kind: "capture", text: "x" }, { ask, record, store })).toBe(true);
    expect(Object.keys(allowedSources(store))).toEqual(["link:capture"]);
    // Remembered: no question the second time; another action still asks.
    ask.mockClear();
    expect(await confirmLink({ kind: "capture", text: "y" }, { ask, record, store })).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    ask.mockResolvedValueOnce({ ok: false, always: false });
    expect(await confirmLink({ kind: "new-note", title: "t", text: null, folder: null }, { ask, record, store })).toBe(false);
    expect(rec).toEqual(["lumen://capture blocked asked", "lumen://capture allowed asked", "lumen://capture allowed remembered", "lumen://new blocked asked"]);
    forgetSource("link:capture", store);
    expect(allowedSources(store)).toEqual({});
  });

  it("an unknown file type is asked every time, even after 'always'", async () => {
    const store = mem();
    const ask = vi.fn(async () => ({ ok: true, always: true }));
    await confirmLink({ kind: "open-file", path: "a.exe" }, { ask, store });
    await confirmLink({ kind: "open-file", path: "a.exe" }, { ask, store });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(allowedSources(store)).toEqual({});
  });

  it("a dialog that cannot show refuses; a hand-made allow list with junk is ignored", async () => {
    const store = mem();
    expect(await confirmLink({ kind: "capture", text: "x" }, { ask: async () => Promise.reject(new Error("no DOM")), store })).toBe(false);
    store.setItem(ALLOW_KEY, JSON.stringify({ "link:capture": 1, "javascript:alert(1)": 2, "clip:https://ok.example": 3, "link:new": "yes" }));
    expect(allowedSources(store)).toEqual({ "link:capture": 1, "clip:https://ok.example": 3 });
    allowSource("file:///etc/passwd", store);
    expect(Object.keys(allowedSources(store))).toEqual(["link:capture", "clip:https://ok.example"]);
  });

  it("every decision is in the privacy ledger, without the note's text", async () => {
    __resetLedger();
    await recordLinkDecision({ kind: "capture", text: "סוד" }, "blocked", "asked");
    await recordLinkDecision({ kind: "new-note", title: "x", text: "סוד", folder: null }, "allowed", "remembered");
    const [blocked, allowed] = ledgerEntries().slice(-2);
    expect(blocked).toMatchObject({ host: "capture", method: "LINK", decision: "blocked", bytesOut: 0, category: "third-party" });
    expect(allowed).toMatchObject({ host: "new", decision: "allowed", bytesOut: 0 });
    expect(allowed.reason).toMatch(/always allow/);
    expect(JSON.stringify(ledgerEntries())).not.toContain("סוד");
  });
});

describe("e2e: a link from a foreign page writes nothing without a yes", () => {
  const desktop = (confirm?: OpenDeps["confirm"]) => {
    const calls: string[] = [];
    const d: OpenDeps = {
      activeRoot: () => "/v",
      switchVault: async () => void calls.push("switch"),
      openVaultFile: async (rel) => void calls.push(`open ${rel}`),
      openStandalone: async () => void calls.push("file"),
      newNote: async (t, text) => void calls.push(`new ${t} ${text}`),
      capture: async (t) => void calls.push(`write inbox ${t}`),
      notifyUnknownVault: () => undefined,
      ...(confirm ? { confirm } : {}),
      peek: async () => '<script src="https://evil.example/x.js"></script>',
    };
    return { d, calls };
  };

  it("desktop lumen://new and lumen://capture: refused → no note, no inbox write; no confirm at all → also nothing (fail closed)", async () => {
    for (const confirm of [async () => false, undefined]) {
      const { d, calls } = desktop(confirm);
      await handleOpenRequest({ kind: "new", title: "Invoice", text: "pay https://evil.example", folder: "Finance" }, d);
      await handleOpenRequest({ kind: "capture", text: "rm -rf" }, d);
      await handleOpenRequest({ kind: "vault", root: "/v", rel: "Downloads/setup.exe", line: null, link: true }, d);
      expect(calls).toEqual([]);
    }
    // The tray's empty "New note" and a file the OS opened are not links: no question.
    const { d, calls } = desktop(async () => false);
    await handleOpenRequest({ kind: "new", title: null, text: null, folder: null }, d);
    await handleOpenRequest({ kind: "vault", root: "/v", rel: "a.md", line: null }, d);
    expect(calls).toEqual(["new null null", "open a.md"]);
  });

  it("desktop: with the real decision, local HTML that loads from the network is opened only after a warned yes", async () => {
    const seen: string[] = [];
    const confirm = (a: LinkAction) => confirmLink(a, { ask: async (dec) => (seen.push(`${dec.risk} ${dec.warning?.key}`), { ok: true, always: true }), store: mem() });
    const { d, calls } = desktop(confirm);
    await handleOpenRequest({ kind: "vault", root: "/v", rel: "page.html", line: null, link: true }, d);
    expect(seen).toEqual(["html-network link.warn.htmlNetwork"]);
    expect(calls).toEqual(["open page.html"]);
  });

  it("mobile lumen://capture?text=…: refused → nothing written; the empty box still opens without a question", async () => {
    const calls: string[] = [];
    const h: NativeHandlers = { capture: () => void calls.push("box"), captureText: async (t) => void calls.push(`inbox ${t}`), newNote: () => undefined, search: () => undefined, daily: () => undefined, confirm: async () => false };
    applyAction(parseNativeUrl("lumen://capture?text=%D7%A1%D7%95%D7%93")!, h);
    applyAction(parseNativeUrl("lumen://capture")!, h);
    applyAction(parseNativeUrl("lumen://capture?text=x")!, { ...h, confirm: undefined });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(["box"]);
  });

  it("clips: the extension's bridge is the user's click; a deep link or #clip= says where it came from, so the app can ask", async () => {
    const got: string[] = [];
    const stop = startClipBridge((p, kind) => void got.push(`${kind} ${p.url}`));
    window.dispatchEvent(new CustomEvent("lumen-deep-link", { detail: `lumen://clip?data=${encodeURIComponent(JSON.stringify({ url: "https://evil.example/", markdown: "x" }))}` }));
    await vi.waitFor(() => expect(got).toEqual(["deep https://evil.example/"]));
    stop();
  });
});

describe("the allow list never travels", () => {
  it("is not a setting: settings export leaves it out and import refuses it", () => {
    expect(SETTINGS.some((e) => (e as { key?: string }).key === ALLOW_KEY || JSON.stringify(e).includes(ALLOW_KEY))).toBe(false);
    const storage = mem();
    allowSource("link:capture", storage);
    const target: SettingsTarget = { getApp: () => ({}), applyApp: () => undefined, storage };
    expect(JSON.stringify(exportSettings(target))).not.toContain(ALLOW_KEY);
    const other = mem();
    const r = importSettings({ format: "lumen-settings", version: 1, app: {}, local: { [ALLOW_KEY]: JSON.stringify({ "link:capture": 1 }) } }, { ...target, storage: other });
    expect(r.skipped).toContain(ALLOW_KEY);
    expect(other.getItem(ALLOW_KEY)).toBeNull();
  });

  it("is read only from this device's storage, never from the vault", async () => {
    // A synced vault cannot grant: nothing reads a vault file for it, and an empty device store means "ask".
    const ask = vi.fn(async () => ({ ok: false, always: false }));
    expect(await confirmLink({ kind: "new-note", title: "x", text: null, folder: null }, { ask, store: mem() })).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
  });
});

describe("the dialog", () => {
  it("says what the link will do, focuses 'Don't allow', offers 'always' only where it is safe, warns about programs", () => {
    const onAnswer = vi.fn();
    const { unmount } = render(createElement(LinkConfirmDialog, { decision: decideLink({ kind: "capture", text: "לקנות חלב" }), onAnswer }));
    expect(screen.getByTestId("link-confirm").textContent).toContain("לקנות חלב");
    expect(document.activeElement?.textContent).toMatch(/Don.t allow/);
    fireEvent.click(screen.getByTestId("link-confirm-always"));
    fireEvent.click(screen.getByTestId("link-confirm-allow"));
    expect(onAnswer).toHaveBeenCalledWith({ ok: true, always: true });
    unmount();
    const r2 = render(createElement(LinkConfirmDialog, { decision: decideLink({ kind: "open-file", path: "setup.exe" }), onAnswer }));
    expect(screen.queryByTestId("link-confirm-always")).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/program \(\.exe\)/);
    r2.unmount();
  });
});
