/**
 * Opening the study screen in the app (plan W12.H2): from the palette on a
 * reference ("Study with a partner"), or from an invite link
 * (`#havruta=<room>&password=<pw>`, collab hook). Loaded on first use.
 */
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { t } from "../i18n";
import "./havrutaStrings";
import { parseSourceRef, type SourceRef } from "../sources/sefaria/refs";
import { writeWorkspaceFile, isOPFSAvailable } from "../storage/workspace";
import { uiConfirm } from "../ui/PromptDialog";
import { roomRef, type HavrutaRef } from "./room";
import { sessionNoteMarkdown, sessionNotePath } from "./sessionNote";
import { StudyScreen } from "./StudyScreen";
import { havrutaInviteLink, havrutaInviteQr, readHavrutaInvite } from "./invite";
import type { HavrutaSession } from "./session";

let mounted: { root: Root; host: HTMLElement; session: HavrutaSession } | null = null;

const today = () => new Date().toISOString().slice(0, 10);
const COLORS = ["#c2410c", "#7c3aed", "#0369a1", "#15803d", "#be185d"];

function Invite({ link }: { link: string }) {
  const [open, setOpen] = useState(false);
  const qr = open ? havrutaInviteQr(link) : null;
  return (
    <div dir="rtl" style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 12px", fontSize: 12, borderBottom: "1px solid hsl(var(--border))" }}>
      <button type="button" onClick={() => void navigator.clipboard?.writeText(link)}>
        {t("havruta.copyInvite")}
      </button>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {t("havruta.qr")}
      </button>
      {qr && (
        <svg role="img" aria-label={t("havruta.qr")} viewBox={`0 0 ${qr.size} ${qr.size}`} width={160} height={160} style={{ background: "#fff" }}>
          <path d={qr.d} fill="#000" />
        </svg>
      )}
    </div>
  );
}

async function save(session: HavrutaSession, ref: HavrutaRef): Promise<string | null> {
  if (!isOPFSAvailable()) return null;
  const names = new Map<number, string>();
  for (const [id, st] of session.awareness.getStates()) if (st && typeof st.name === "string") names.set(id, st.name);
  const path = sessionNotePath(ref, today());
  await writeWorkspaceFile(path, sessionNoteMarkdown({ doc: session.doc, date: today(), names }));
  window.dispatchEvent(new Event("lumen-workspace-changed"));
  return path;
}

export function closeStudyScreen(): void {
  if (!mounted) return;
  const m = mounted;
  mounted = null;
  void m.session.leave();
  m.root.unmount();
  m.host.remove();
}

/** Open the screen: a new room on `ref`, or the room of an invite. */
export async function openStudyScreen(opts: { ref?: SourceRef; invite?: { room: string; password: string } }): Promise<void> {
  closeStudyScreen();
  const { startHavruta, studyText } = await import("./app");
  const name = t("havruta.defaultName");
  let ended = false;
  const { session, password } = await startHavruta({
    ref: opts.ref ? { key: opts.ref.key, he: opts.ref.he } : undefined,
    room: opts.invite?.room,
    password: opts.invite?.password,
    onEnded: () => {
      ended = true;
    },
  });
  const hRef = roomRef(session.doc) ?? (opts.ref ? { key: opts.ref.key, he: opts.ref.he } : null);
  const sref = opts.ref ?? (hRef ? parseSourceRef(hRef.key) : null);
  if (!sref || !hRef) {
    // Joined before the room's reference arrived (the partner is offline): the screen opens when it does.
    await session.leave();
    throw new Error(t("havruta.noRef"));
  }
  const text = await studyText(sref, () => uiConfirm({ message: t("sources.confirmFetch", { ref: sref.tref }) }));
  if ("unavailable" in text) {
    await session.leave();
    throw new Error(text.unavailable === "offline" ? t("havruta.offlineNoText") : t("havruta.declined"));
  }
  const host = document.createElement("div");
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-label", t("havruta.title", { ref: hRef.he }));
  Object.assign(host.style, { position: "fixed", inset: "48px 0 0 0", zIndex: "45", display: "flex", flexDirection: "column", background: "hsl(var(--bg))" });
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted = { root, host, session };
  const link = havrutaInviteLink(`${location.origin}${location.pathname}`, session.room, password);
  const color = COLORS[session.doc.clientID % COLORS.length];
  root.render(
    <>
      <Invite link={link} />
      <StudyScreen
        session={session}
        text={text}
        me={{ name, color }}
        onSave={() => save(session, hRef)}
        onEnd={async () => {
          await save(session, hRef);
          if (!ended) await session.end();
          closeStudyScreen();
        }}
      />
    </>,
  );
}

/** An invite in the address bar: join after the user agrees. */
export async function joinHavrutaFromHash(): Promise<void> {
  const invite = readHavrutaInvite(location.hash);
  if (!invite) return;
  if (!(await uiConfirm({ message: t("havruta.join") }))) return;
  history.replaceState(null, "", location.pathname + location.search);
  await openStudyScreen({ invite });
}
