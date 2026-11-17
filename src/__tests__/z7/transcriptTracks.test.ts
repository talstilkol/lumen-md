/**
 * Review Z7-M5 (#938): meeting transcription wrote `.vtt`/`.srt` straight to the vault, named by date and stem, so
 * a second recording with the same stem (`meeting.m4a`, then `meeting.wav`) replaced the first one's tracks, and a
 * hand-corrected `rec.vtt` was overwritten on a new run. Now the tracks keep the audio's extension
 * (`rec.m4a.vtt`), they are proposed to the review panel (agents/staging, W10.C12) and only approval writes them,
 * refused when the file changed after it was read; and the kept audio never replaces another recording.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setVaultBackend } from "../../storage/vault";
import { createMemoryBackend } from "../../storage/vault/memory";
import type { VaultBackend } from "../../storage/vault/types";
import * as workspace from "../../storage/workspace";
import { approveStagedChange, clearStagedChanges, listStagedChanges } from "../../agents/staging";
import { writeTranscriptTracks } from "../../meetings/meetingTranscribe";
import { keepAudio, numberedName } from "../../ui/TranscribeFile";
import { trackPath } from "../../media/webvtt";

const S1 = [{ start: 0, end: 2, text: "first recording", speaker: null }];
const S2 = [{ start: 0, end: 2, text: "second recording", speaker: null }];
let previous: VaultBackend | null = null;
beforeEach(() => {
  previous = setVaultBackend(createMemoryBackend());
  clearStagedChanges();
});
afterEach(() => {
  setVaultBackend(previous);
  clearStagedChanges();
});

describe("Z7-M5: transcript tracks go through the review queue", () => {
  it("nothing is written before approval; approval writes the track", async () => {
    const paths = await writeTranscriptTracks("attachments/2026-11-15-meeting.m4a", S1);
    expect(paths).toEqual(["attachments/2026-11-15-meeting.m4a.vtt", "attachments/2026-11-15-meeting.m4a.srt"]);
    for (const p of paths) expect(await workspace.workspaceHasFile(p)).toBe(false);
    const pending = listStagedChanges();
    expect(pending.map((c) => [c.path, c.before, c.tool])).toEqual(paths.map((p) => [p, null, "transcript_tracks"]));
    await approveStagedChange(pending[0].id);
    expect(await workspace.readWorkspaceFile(paths[0])).toContain("first recording");
  });

  it("two recordings with one stem on one day get two tracks, not one shared", async () => {
    const a = await writeTranscriptTracks("attachments/2026-11-15-meeting.m4a", S1);
    const b = await writeTranscriptTracks("attachments/2026-11-15-meeting.wav", S2);
    expect(new Set([...a, ...b]).size).toBe(4);
    for (const c of listStagedChanges()) await approveStagedChange(c.id);
    expect(await workspace.readWorkspaceFile(trackPath("attachments/2026-11-15-meeting.m4a"))).toContain("first recording");
    expect(await workspace.readWorkspaceFile(trackPath("attachments/2026-11-15-meeting.wav"))).toContain("second recording");
  });

  it("a hand-corrected track is not overwritten: it is the proposal's `before`, and an edit after the read refuses approval", async () => {
    const audio = "attachments/rec.m4a";
    const vtt = trackPath(audio);
    const corrected = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\ncorrected by hand\n";
    await workspace.writeWorkspaceFile(vtt, corrected);
    await writeTranscriptTracks(audio, S1);
    expect(await workspace.readWorkspaceFile(vtt)).toBe(corrected);
    const change = listStagedChanges().find((c) => c.path === vtt)!;
    expect(change.before).toBe(corrected);
    // The user edits the track again before deciding: approval refuses, the edit stays.
    await workspace.writeWorkspaceFile(vtt, corrected + "\n00:00:02.000 --> 00:00:03.000\nmore\n");
    const r = await approveStagedChange(change.id);
    expect([r.status, r.conflict]).toEqual(["conflict", "file-changed"]);
    expect(await workspace.readWorkspaceFile(vtt)).toContain("more");
  });

  it("a track that would not change is not proposed again", async () => {
    await writeTranscriptTracks("attachments/x.m4a", S1);
    for (const c of listStagedChanges()) await approveStagedChange(c.id);
    clearStagedChanges();
    expect(await writeTranscriptTracks("attachments/x.m4a", S1)).toEqual([]);
    expect(listStagedChanges()).toEqual([]);
  });
});

describe("Z7-M5: the kept audio never replaces another recording", () => {
  it("a second file with the same name on the same day is kept as -2", async () => {
    const file = (text: string) => Object.assign(new Blob([text], { type: "audio/mp4" }), { name: "meeting.m4a" });
    const a = await keepAudio(file("one"));
    const b = await keepAudio(file("two"));
    expect(a).not.toBe(b);
    expect(b).toBe(numberedName(a!, 2));
    expect(await (await workspace.readWorkspaceBlob(a!)).text()).toBe("one");
    expect(await (await workspace.readWorkspaceBlob(b!)).text()).toBe("two");
    expect(numberedName("attachments/x", 3)).toBe("attachments/x-3");
  });
});
