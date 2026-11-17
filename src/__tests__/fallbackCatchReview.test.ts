/**
 * W10.A8 follow-up (FA): the fallback catches of storage and sync — a catch
 * or `.catch()` that goes on with a default (null, false, [], undefined…)
 * without reporting. codeHealth's W10.A8 check only refuses empty ones, so
 * ~200 of these passed it; each was reviewed (FC1):
 *
 *  - kept quiet (the expected outcome, not an error): probes and lookups
 *    (stat, exists, "is it a folder"), parsing optional or user-provided
 *    data (JSON, YAML, URLs, base64, charsets), feature and storage
 *    detection (localStorage, sessionStorage, Capacitor, PRF), decryption
 *    or MAC checks whose "no" is the protocol's answer, reading an error
 *    response's body, waiting on a previous save whose failure its own
 *    caller reports, best-effort cleanup of probe and pairing objects
 *    (public keys and MACs), clipboard writes, rounds whose failure the
 *    session already shows (syncNow sets the error and the status bar),
 *    and the leftovers of an atomic save (storage/vault/atomic.ts has no
 *    imports, as the SIGKILL crash test runs it in plain Node, and the
 *    next open's recovery clears them);
 *  - now reported with `swallowed()` (37 sites): a failed rollback of a
 *    move (the replaced file stays in the trash), a failed undo of an
 *    import, history pruning, trash index and trash deletes, leftovers of
 *    CAS and moves, a sealed value that does not decrypt, the
 *    search snapshot refused or unreadable, notes left out of the index or
 *    of readAllNotes, stat failures that are not "not found", the vault id
 *    and encryption state, the history versions a merge or a git pull keeps
 *    (the safety net of an automatic merge), the working-copy delete of a
 *    pull, re-revocations after a keyring fork, uncommitted key-change
 *    objects, the vault watcher, and the automatic vault snapshots.
 *
 * The ratchet below holds every file to its reviewed count: a new quiet
 * fallback in storage or sync fails here until it is reviewed (reported, or
 * the count raised in review with the reason).
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { recentLogs } from "../lib/logger";

// The note history refuses every version (a full quota): what a merge's safety net meets on a full disk.
vi.mock("../storage/history", () => ({ recordSnapshot: async () => Promise.reject(new Error("QuotaExceededError")) }));

const SRC = join(__dirname, "..");

/** A handler reports, records, rethrows or hands the error on when it mentions one of these. */
const REPORTS = /\b(swallowed|log\.(warn|error|info|debug)|console\.(warn|error)|report\w*|record\w*|emit|throw|remember|logRule|captureException|onError|warn\()/;

function quietIn(text: string, file: string): number[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: number[] = [];
  const visit = (n: ts.Node): void => {
    let body: ts.Node | null = null;
    if (ts.isCatchClause(n)) body = n.block;
    else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "catch") {
      const h = n.arguments[0];
      if (h && (ts.isArrowFunction(h) || ts.isFunctionExpression(h))) body = h.body;
    }
    if (body && !REPORTS.test(body.getText(sf))) out.push(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function sources(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n !== "__tests__") sources(p, out);
    } else if (/\.tsx?$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}

/** Quiet fallbacks per file after the review (FC1). Lower is fine; higher fails. */
const REVIEWED: Record<string, number> = {
  "storage/aiPromptHistory.ts": 1,
  "storage/attachmentPolicy.ts": 1,
  "storage/attachmentRefs.ts": 1,
  "storage/evictionReminder.ts": 1,
  "storage/exportAll.ts": 1,
  "storage/exportDocx.ts": 2,
  "storage/fileFormats.ts": 3,
  "storage/fileOps.ts": 3,
  "storage/formatRoundTrip.ts": 1,
  "storage/history.ts": 3,
  "storage/historyDelta.ts": 1,
  "storage/import/ImportWizard.tsx": 4,
  "storage/import/appleNotes.ts": 3,
  "storage/import/commit.ts": 1,
  "storage/import/convert.ts": 1,
  "storage/import/evernote.ts": 1,
  "storage/import/frontmatter.ts": 1,
  "storage/import/html.ts": 1,
  "storage/import/htmlNotes.ts": 2,
  "storage/import/keep.ts": 1,
  "storage/import/notion.ts": 1,
  "storage/import/notionDates.ts": 2,
  "storage/import/onenoteGraph.ts": 5,
  "storage/import/onenoteReturn.ts": 1,
  "storage/import/onenoteSignIn.ts": 2,
  "storage/iwork.ts": 4,
  "storage/lockedNote.ts": 1,
  "storage/markupFormats.ts": 4,
  "storage/officeFormats.ts": 6,
  "storage/persistentStorage.ts": 1,
  "storage/recent.ts": 1,
  "storage/searchHistory.ts": 2,
  "storage/templateMarketplace.ts": 2,
  "storage/trash.ts": 3,
  "storage/vault/atomic.ts": 5,
  "storage/vault/cas.ts": 2,
  "storage/vault/encrypted/session.ts": 5,
  "storage/vault/handleBackend.ts": 8,
  "storage/vault/index.ts": 1,
  "storage/vault/integrity.ts": 5,
  "storage/vault/integrityCommand.ts": 1,
  "storage/vault/location.ts": 2,
  "storage/vault/mobile.ts": 3,
  "storage/vault/moveCheck.ts": 6,
  "storage/vault/opfs.ts": 2,
  "storage/vault/vaultIoFs.ts": 6,
  "storage/vault/watchNotice.ts": 1,
  "storage/vault/watcher.ts": 1,
  "storage/vaultIndexCore.ts": 1,
  "storage/vaultIndexLocal.ts": 2,
  "storage/vaultIndexProtocol.ts": 1,
  "storage/workspace.ts": 2,
  "storage/workspaceBulk.ts": 3,
  "storage/workspaceIndex.ts": 7,
  "storage/workspaceIndexRead.ts": 2,
  "sync/cloud/dropbox.ts": 3,
  "sync/cloud/gdrive.ts": 2,
  "sync/e2ee/background.ts": 3,
  "sync/e2ee/classroom/ClassroomPanel.tsx": 1,
  "sync/e2ee/classroom/classroom.ts": 1,
  "sync/e2ee/classroom/open.tsx": 1,
  "sync/e2ee/conflict.ts": 1,
  "sync/e2ee/conflictMode.ts": 2,
  "sync/e2ee/engine.ts": 1,
  "sync/e2ee/engineCore.ts": 6,
  "sync/e2ee/engineKeys.ts": 4,
  "sync/e2ee/enginePairing.ts": 4,
  "sync/e2ee/engineTypes.ts": 1,
  "sync/e2ee/estimate.ts": 1,
  "sync/e2ee/header.ts": 2,
  "sync/e2ee/keyring.ts": 1,
  "sync/e2ee/lan/bucket.ts": 1,
  "sync/e2ee/lan/channel.ts": 2,
  "sync/e2ee/lan/discovery.ts": 2,
  "sync/e2ee/lan/index.ts": 1,
  "sync/e2ee/lan/link.ts": 2,
  "sync/e2ee/lan/rpc.ts": 6,
  "sync/e2ee/pairing.ts": 1,
  "sync/e2ee/passkey.ts": 1,
  "sync/e2ee/primitives/lib/argon2Worker.ts": 1,
  "sync/e2ee/primitives/lib/audited.ts": 1,
  "sync/e2ee/provider.ts": 2,
  "sync/e2ee/providers/http.ts": 3,
  "sync/e2ee/providers/index.ts": 1,
  "sync/e2ee/providers/relay.ts": 2,
  "sync/e2ee/providers/s3.ts": 1,
  "sync/e2ee/providers/webdav.ts": 3,
  "sync/e2ee/roles/envelope.ts": 1,
  "sync/e2ee/roles/provider.ts": 3,
  "sync/e2ee/roles/ui/InviteScreen.tsx": 1,
  "sync/e2ee/roles/ui/open.tsx": 1,
  "sync/e2ee/roles/vault.ts": 3,
  "sync/e2ee/ui/FreshnessBanner.tsx": 2,
  "sync/e2ee/ui/LanPairing.tsx": 7,
  "sync/e2ee/ui/PasskeyUnlock.tsx": 1,
  "sync/e2ee/ui/PassphraseForm.tsx": 1,
  "sync/e2ee/ui/RecoveryKit.tsx": 2,
  "sync/e2ee/ui/SetupWizard.tsx": 4,
  "sync/e2ee/ui/SyncActivity.tsx": 2,
  "sync/e2ee/ui/SyncPanel.tsx": 8,
  "sync/e2ee/ui/SyncRulesForm.tsx": 1,
  "sync/e2ee/ui/session.ts": 5,
  "sync/e2ee/vaultOpen.ts": 1,
  "sync/git.ts": 5,
  "sync/gitAsOf.ts": 1,
  "sync/gitMerge.ts": 1,
  "sync/gitMirror.ts": 2,
  "sync/gitProxy.ts": 3,
  "sync/gitPull.ts": 1,
  "sync/gitWatch.ts": 1,
  "sync/merge/textMerge.ts": 1,
  "sync/publish.ts": 3,
};

describe("W10.A8 follow-up: the fallback catches of storage and sync, reviewed", () => {
  it("no file has more quiet fallbacks than its reviewed count, and no new file has any", () => {
    const over: string[] = [];
    for (const dir of ["storage", "sync"]) {
      for (const file of sources(join(SRC, dir))) {
        const text = readFileSync(file, "utf8");
        if (!text.includes("catch")) continue;
        const rel = relative(SRC, file).split("\\").join("/");
        const lines = quietIn(text, file);
        if (lines.length > (REVIEWED[rel] ?? 0)) over.push(`${rel}: ${lines.length} quiet fallbacks (reviewed: ${REVIEWED[rel] ?? 0}) at lines ${lines.join(", ")}`);
      }
    }
    expect(over).toEqual([]);
  });

  it("the scan counts a quiet fallback and not a reporting one", () => {
    expect(quietIn("try { a(); } catch { return null; }\np.catch(() => undefined);\n", "f.ts")).toEqual([1, 2]);
    expect(quietIn('try { a(); } catch (e) { swallowed("f: x", e); return null; }\np.catch((e) => (swallowed("f: y", e), 0));\n', "f.ts")).toEqual([]);
  });

  it("a merge whose history snapshot fails still merges, and says so once", async () => {
    const { keepBothVersions } = await import("../sync/merge/keepVersions");
    const before = recentLogs().length;
    await expect(keepBothVersions("notes/a.md", "ours", "theirs")).resolves.toBeUndefined();
    const logged = recentLogs().slice(before).map((r) => r.message);
    expect(logged.filter((m) => m.startsWith("swallowed: sync/merge/keepVersions: ")).length).toBe(2);
    expect(logged.join("\n")).not.toContain("ours");
  });

});
