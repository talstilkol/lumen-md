/**
 * `![[rec.m4a]]` and `![[talk.mp4]]` (plan W12.F8): the player, and beside it
 * the transcript from the `.vtt` (or `.srt`) file next to the media, as text
 * you can read and search on the page. Clicking a line moves the player to
 * that moment; the line being spoken is marked as it plays. The track is
 * also attached to the player as a `<track>`, so captions work in a video.
 *
 * Everything is read from the vault: the media as a blob URL (the policy
 * allows `media-src blob:`), the transcript as text. Nothing is transcribed
 * here; a file without a transcript is just a player.
 */
import "./strings";
import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import { cueAt, parseTrack, sidecarPath, toWebVtt, trackPath, VIDEO_EXT, type Cue } from "./webvtt";

export interface MediaIo {
  /** The vault path for an embed target (`rec.m4a` may be in any folder), or null. */
  resolve(target: string): Promise<string | null>;
  readBlob(path: string): Promise<Blob>;
  /** A text file, or null when there is none. */
  readText(path: string): Promise<string | null>;
}

const workspaceIo: MediaIo = {
  async resolve(target) {
    const ws = await import("../storage/workspace");
    if (await ws.workspaceHasFile(target).catch(() => false)) return target;
    const name = target.split("/").pop()!.toLowerCase();
    const hit = (await ws.listWorkspace()).find((f) => f.path.toLowerCase().endsWith(`/${name}`) || f.path.toLowerCase() === name);
    return hit?.path ?? null;
  },
  readBlob: async (p) => (await import("../storage/workspace")).readWorkspaceBlob(p),
  async readText(p) {
    const ws = await import("../storage/workspace");
    return (await ws.workspaceHasFile(p).catch(() => false)) ? ws.readWorkspaceFile(p) : null;
  },
};

const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

export function MediaEmbed({ target, io = workspaceIo }: { target: string; io?: MediaIo }) {
  const [src, setSrc] = useState<string | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [missing, setMissing] = useState(false);
  const [now, setNow] = useState(-1);
  const player = useRef<HTMLMediaElement | null>(null);
  const video = VIDEO_EXT.test(target);

  useEffect(() => {
    let live = true;
    let url: string | null = null;
    (async () => {
      const path = await io.resolve(target);
      if (!path) {
        if (live) setMissing(true);
        return;
      }
      const blob = await io.readBlob(path);
      url = URL.createObjectURL(blob);
      if (live) setSrc(url);
      // The app's own track (`rec.m4a.vtt`, Z7-M5) first, then one named by the stem (`rec.vtt`, other apps, older builds).
      let track: ReturnType<typeof parseTrack> | null = null;
      for (const [p, kind] of [[trackPath(path, "vtt"), "vtt"], [trackPath(path, "srt"), "srt"], [sidecarPath(path, "vtt"), "vtt"], [sidecarPath(path, "srt"), "srt"]] as const) {
        const text = await io.readText(p);
        if (text !== null) {
          track = parseTrack(text, kind);
          break;
        }
      }
      if (live && track) setCues(track.cues);
    })().catch(() => live && setMissing(true));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [target, io]);

  // The track element wants a URL; the cues are turned back into WebVTT for it.
  const trackUrl = useMemo(() => (cues.length && typeof URL.createObjectURL === "function" ? URL.createObjectURL(new Blob([toWebVtt(cues)], { type: "text/vtt" })) : null), [cues]);
  useEffect(() => () => void (trackUrl && URL.revokeObjectURL(trackUrl)), [trackUrl]);

  if (missing) return <span className="media-embed-missing">{t("media.missing", { target })}</span>;

  const seek = (k: number) => {
    const el = player.current;
    if (!el) return;
    el.currentTime = cues[k].start;
    setNow(k);
    void el.play?.()?.catch?.(() => undefined);
  };
  const Player = video ? "video" : "audio";

  return (
    <figure className="media-embed" data-target={target}>
      <Player
        ref={(el: HTMLMediaElement | null) => {
          player.current = el;
        }}
        controls
        preload="metadata"
        src={src ?? undefined}
        onTimeUpdate={(e) => setNow(cueAt(cues, (e.currentTarget as HTMLMediaElement).currentTime))}
      >
        {trackUrl && <track kind="captions" src={trackUrl} default />}
      </Player>
      {cues.length > 0 && (
        <figcaption>
          <details open>
            <summary>{t("media.transcript", { n: cues.length })}</summary>
            <ol className="media-transcript" dir="auto">
              {cues.map((c, k) => (
                <li key={k} aria-current={k === now ? "true" : undefined}>
                  <button type="button" className="media-cue-time" dir="ltr" aria-label={t("media.seek", { time: clock(c.start) })} onClick={() => seek(k)}>
                    {clock(c.start)}
                  </button>{" "}
                  {c.voice && <strong>{c.voice}: </strong>}
                  <span>{c.text}</span>
                </li>
              ))}
            </ol>
          </details>
        </figcaption>
      )}
    </figure>
  );
}

export default MediaEmbed;
