/**
 * Plan W12.H2 — the havruta study screen, two partners side by side.
 *
 * Two real sessions (src/havruta/session.ts: the room's Yjs document,
 * end-to-end encrypted with src/collab/e2e.ts and e2eAwareness) are linked
 * by an in-memory relay that passes only their transport documents and
 * transport presence, i.e. ciphertext, as the live-share server does. Each
 * partner has their own <StudyScreen>. Checked: a note, a selection, "follow
 * my partner", saving to the vault, keyboard navigation between segments,
 * and axe (no serious or critical violation).
 *
 * The passage is SYNTHETIC in Sefaria's form: Genesis 1:1–3 in Hebrew (the
 * public-domain Masoretic text), unpointed Aramaic (Targum Onkelos 1:1, public
 * domain) and a made-up copyrighted translation (link-only).
 * The browser e2e of the same flow (two browsers, a local relay) is the Mac's.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { StudyScreen } from "../havruta/StudyScreen";
import { openHavruta, type HavrutaConnect, type HavrutaSession } from "../havruta/session";
import { sessionNoteMarkdown, sessionNotePath } from "../havruta/sessionNote";
import { newHavrutaRoomName } from "../havruta/room";
import type { StudyText } from "../havruta/text";

const HE = ["בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ׃", "וְהָאָרֶץ הָיְתָה תֹהוּ וָבֹהוּ וְחֹשֶׁךְ עַל־פְּנֵי תְהוֹם׃", "וַיֹּאמֶר אֱלֹהִים יְהִי אוֹר וַיְהִי־אוֹר׃"];
const ARC = ["בקדמין ברא יי ית שמיא וית ארעא", "וארעא הות צדיא וריקניא", "ואמר יי יהי נהורא והוה נהורא"];
const TEXT: StudyText = {
  ref: { key: "Genesis.1.1-3", tref: "Genesis 1:1-3", he: "בראשית א׳:א׳-ג׳" } as unknown as StudyText["ref"],
  heRef: "בראשית א׳:א׳-ג׳",
  from: "vault",
  versions: [
    { title: "Miqra", language: "he", direction: "rtl", license: "Public Domain", licenseLabel: "Public Domain", licenseUrl: null, free: true, segments: HE },
    { title: "Onkelos", language: "arc", direction: "rtl", license: "Public Domain", licenseLabel: "Public Domain", licenseUrl: null, free: true, segments: ARC },
    { title: "Example translation", language: "en", direction: "ltr", license: "Copyright: Example", licenseLabel: "Copyright: Example", licenseUrl: null, free: false, segments: null },
  ],
};

/** The relay in memory: transport documents and presence only (ciphertext), as the server sees them. */
function memoryRelay() {
  const peers: Array<{ doc: Y.Doc; aw: Awareness }> = [];
  const seen: Uint8Array[] = [];
  const connect: HavrutaConnect = async (doc, aw) => {
    const me = { doc, aw };
    for (const p of peers) {
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(p.doc), "relay");
      Y.applyUpdate(p.doc, Y.encodeStateAsUpdate(doc), "relay");
    }
    const onDoc = (u: Uint8Array, origin: unknown) => {
      if (origin === "relay") return;
      seen.push(u);
      for (const p of peers) if (p !== me) Y.applyUpdate(p.doc, u, "relay");
    };
    const onAw = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === "relay") return;
      const u = encodeAwarenessUpdate(aw, added.concat(updated, removed));
      seen.push(u);
      for (const p of peers) if (p !== me) applyAwarenessUpdate(p.aw, u, "relay");
    };
    doc.on("update", onDoc);
    aw.on("update", onAw);
    for (const p of peers) applyAwarenessUpdate(aw, encodeAwarenessUpdate(p.aw, [...p.aw.getStates().keys()]), "relay");
    peers.push(me);
    for (const p of peers) if (p !== me) applyAwarenessUpdate(p.aw, encodeAwarenessUpdate(aw, [...aw.getStates().keys()]), "relay");
    return { destroy: () => (doc.off("update", onDoc), aw.off("update", onAw), peers.splice(peers.indexOf(me), 1)) };
  };
  return { connect, seen };
}

const sessions: HavrutaSession[] = [];
afterEach(async () => {
  for (const s of sessions.splice(0)) await s.leave();
  document.body.innerHTML = "";
});
beforeAll(async () => {
  const warm = document.createElement("div");
  warm.innerHTML = '<button type="button">warm</button>';
  document.body.appendChild(warm);
  await axe.run(warm, { runOnly: ["wcag2a", "wcag2aa"], resultTypes: ["violations"] });
  warm.remove();
});

async function pair() {
  const relay = memoryRelay();
  const room = newHavrutaRoomName();
  const a = await openHavruta({ room, password: "screen pw", ref: { key: "Genesis.1.1-3", he: "בראשית א׳:א׳-ג׳" }, connect: relay.connect });
  const b = await openHavruta({ room, password: "screen pw", connect: relay.connect });
  sessions.push(a, b);
  const saved: string[] = [];
  const screen = (s: HavrutaSession, name: string, color: string) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    return render(<StudyScreen session={s} text={TEXT} me={{ name, color }} onSave={async () => (saved.push(sessionNoteMarkdown({ doc: s.doc, date: "2026-11-15", names: new Map() })), "Havruta/x.md")} onEnd={async () => undefined} />, { container: host });
  };
  return { a, b, A: screen(a, "Dana", "#c2410c"), B: screen(b, "Noa", "#7c3aed"), relay, saved };
}

describe("the study screen with two partners", () => {
  it("text and translation by segment, link-only versions as a link; the partner's presence shows", async () => {
    const { A, B } = await pair();
    const a = within(A.container);
    expect(a.getByTestId("havruta-text-0-he").textContent).toBe(HE[0]);
    expect(a.getByTestId("havruta-text-0-arc").getAttribute("dir")).toBe("rtl");
    expect(a.queryByText(/When God began/)).toBeNull();
    expect(a.getByRole("link", { name: /Sefaria/ }).getAttribute("href")).toBe("https://www.sefaria.org/Genesis%201:1-3");
    await waitFor(() => expect(within(B.container).getByTestId("havruta-partner").textContent).toMatch(/Dana/));
  });

  it("a note on a segment appears in the partner's column; a copy of the text is refused", async () => {
    const { A, B } = await pair();
    const a = within(A.container);
    act(() => a.getByTestId("havruta-seg-1").focus());
    fireEvent.change(a.getByTestId("havruta-note"), { target: { value: "למה תהו ובהו לפני האור?" } });
    fireEvent.click(a.getByTestId("havruta-add"));
    expect(within(a.getByTestId("havruta-mine-1")).getByText("למה תהו ובהו לפני האור?")).toBeTruthy();
    await waitFor(() => expect(within(B.container).getByTestId("havruta-theirs-1").textContent).toContain("למה תהו ובהו לפני האור?"));
    fireEvent.change(a.getByTestId("havruta-note"), { target: { value: "והארץ היתה תהו ובהו וחשך על פני תהום" } });
    fireEvent.click(a.getByTestId("havruta-add"));
    expect(a.getByRole("alert").textContent).toMatch(/repeats the text|חוזרת על הטקסט/);
  });

  it("the partner's selection is drawn in their colour, and 'follow' moves with them", async () => {
    const { a, A, B } = await pair();
    const b = within(B.container);
    fireEvent.click(b.getByTestId("havruta-follow"));
    // Dana selects the first word of segment 2 on her screen.
    const p = within(A.container).getByTestId("havruta-text-2-he");
    act(() => within(A.container).getByTestId("havruta-seg-2").focus());
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 7);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.mouseUp(p);
    expect(a.awareness.getLocalState()).toMatchObject({ segment: 2, selection: { version: "Miqra", start: 0, end: 7 } });
    await waitFor(() => expect(b.getByTestId("havruta-seg-2").getAttribute("aria-current")).toBe("true"));
    await waitFor(() => expect(b.getByTestId("havruta-text-2-he").querySelector('mark[data-mark="partner"]')?.textContent).toBe(HE[2].slice(0, 7)));
    expect(b.getByTestId("havruta-seg-2").getAttribute("data-partner-here")).toBe("1");
  });

  it("keyboard: one tab stop, ↑/↓/Home/End between segments, Enter to the note box, Escape back", async () => {
    const { A } = await pair();
    const a = within(A.container);
    const seg = (i: number) => a.getByTestId(`havruta-seg-${i}`);
    expect([0, 1, 2].map((i) => seg(i).tabIndex)).toEqual([0, -1, -1]);
    act(() => seg(0).focus());
    fireEvent.keyDown(seg(0), { key: "ArrowDown" });
    expect(document.activeElement).toBe(seg(1));
    fireEvent.keyDown(seg(1), { key: "End" });
    expect(document.activeElement).toBe(seg(2));
    fireEvent.keyDown(seg(2), { key: "Home" });
    expect(document.activeElement).toBe(seg(0));
    fireEvent.keyDown(seg(0), { key: "Enter" });
    await waitFor(() => expect(document.activeElement).toBe(a.getByTestId("havruta-note")));
    fireEvent.keyDown(a.getByTestId("havruta-note"), { key: "Escape" });
    expect(document.activeElement).toBe(seg(0));
  });

  it("niqqud is for display only: hiding it changes the screen, not the text", async () => {
    const { A } = await pair();
    const a = within(A.container);
    fireEvent.click(a.getByTestId("havruta-nikud"));
    expect(a.getByTestId("havruta-text-0-he").textContent).toBe("בראשית ברא אלהים את השמים ואת הארץ׃");
    expect(TEXT.versions[0].segments![0]).toBe(HE[0]);
  });

  it("save to vault: one note with both partners' notes and the pointers, never the text", async () => {
    const { a, b, A, saved } = await pair();
    act(() => within(A.container).getByTestId("havruta-seg-0").focus());
    fireEvent.change(within(A.container).getByTestId("havruta-note"), { target: { value: "בראשית — בזכות התורה" } });
    fireEvent.click(within(A.container).getByTestId("havruta-add"));
    await waitFor(() => expect(b.doc.getArray("notes").length).toBe(1));
    const { addNote } = await import("../havruta/room");
    addNote(b.doc, { segment: 0, text: "ורש״י: בשביל ישראל", name: "Noa", sourceSegments: HE });
    await waitFor(() => expect(a.doc.getArray("notes").length).toBe(2));
    fireEvent.click(within(A.container).getByTestId("havruta-save"));
    await waitFor(() => expect(saved).toHaveLength(1));
    const md = saved[0];
    expect(md).toContain("# חברותא — בראשית א׳:א׳-ג׳ — 2026-11-15");
    expect(md).toContain("[[Genesis.1.1-3|בראשית א׳:א׳-ג׳]]");
    expect(md).toContain("- **Dana**: בראשית — בזכות התורה");
    expect(md).toContain("- **Noa**: ורש״י: בשביל ישראל");
    for (const v of [...HE, ...ARC]) expect(md).not.toContain(v);
    expect(sessionNotePath({ key: "Genesis.1.1-3", he: "בראשית א׳:א׳-ג׳" }, "2026-11-15")).toBe("Havruta/חברותא — בראשית א׳ א׳-ג׳ — 2026-11-15.md");
  });

  it("what the relay passed is ciphertext: no word of the text or of a note", async () => {
    const { A, relay } = await pair();
    act(() => within(A.container).getByTestId("havruta-seg-0").focus());
    fireEvent.change(within(A.container).getByTestId("havruta-note"), { target: { value: "שאלה גלויה" } });
    fireEvent.click(within(A.container).getByTestId("havruta-add"));
    await new Promise((r) => setTimeout(r, 50));
    const all = relay.seen.map((u) => new TextDecoder().decode(u)).join("\n");
    expect(relay.seen.length).toBeGreaterThan(0);
    for (const w of ["שאלה", "גלויה", "Dana", "Miqra", ...HE[0].split(" ")]) expect(all.includes(w), w).toBe(false);
  });

  it("axe: no serious or critical violation", async () => {
    const { A } = await pair();
    const r = await axe.run(A.container, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"], resultTypes: ["violations"] });
    const blockers = r.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    expect(blockers.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  }, 30_000);
});
