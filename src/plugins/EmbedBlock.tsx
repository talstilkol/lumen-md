/**
 * ```embed block: a pasted link becomes the provider's player (plan W4.15).
 *
 * Nothing loads until the user allows the provider's host ("Load" / "Always
 * allow", the same choice as for images, src/lib/remoteImages.ts); then the
 * player renders inside the content frame (src/lib/contentFrame.ts), whose
 * policy frames these providers — the app's own frames nothing but itself.
 * A Gist is GitHub's embed script, run in an opaque-origin content frame. A
 * link to any other site stays a link.
 */
import "../renderer/contentFrameStrings";
import { lazy, Suspense } from "react";
import { t } from "../i18n";
import { remoteImageHost, remoteImagesUnavailable } from "../lib/remoteImages";
import { embedFor, type Embed } from "./embedUrl";

// The gate and the content frame load with the first embed that is a player.
const RemoteFrameGate = lazy(() => import("../renderer/RemoteFrame").then((m) => ({ default: m.RemoteFrameGate })));

interface Props {
  source: string;
}

export default function EmbedBlock({ source }: Props) {
  // Allow multi-line; render the first non-empty URL only.
  const url = source.split("\n").map((s) => s.trim()).find(Boolean) ?? "";
  const embed = embedFor(url);

  if (!embed) {
    return (
      <div className="chart-block" style={{ padding: "1rem" }}>
        <div style={{ color: "hsl(0 80% 60%)", fontSize: 13 }}>
          {t("block.embed.unrecognized")}
        </div>
      </div>
    );
  }

  return (
    <div className="chart-block">
      <div className="chart-block-header">
        <span>{embed.title}</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "hsl(var(--accent))", fontSize: 11 }}
        >
          {t("block.embed.open")}
        </a>
      </div>
      <EmbedBody embed={embed} />
    </div>
  );
}

const notice = { padding: "0.75rem 1rem", fontSize: 13, color: "hsl(var(--fg-muted))" } as const;

function EmbedBody({ embed }: { embed: Embed }) {
  const host = remoteImageHost(embed.src) ?? "";
  if (embed.generic) {
    return <div style={notice} dir="auto">{t("block.embed.notEmbeddable", { host })}</div>;
  }
  if (embed.gist) {
    // The desktop app's policy runs no script from gist.github.com.
    if (remoteImagesUnavailable()) return <div style={notice} dir="auto">{t("block.embed.gistDesktop")}</div>;
    return (
      <Suspense fallback={null}>
        <RemoteFrameGate gateUrl={embed.src} request={{ kind: "gist", ...embed.gist }} />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={null}>
      <RemoteFrameGate
        gateUrl={embed.src}
        request={{ kind: "embed", src: embed.src, title: embed.title, allow: embed.allow, referrerPolicy: "strict-origin-when-cross-origin" }}
        box={{ position: "relative", width: "100%", aspectRatio: `100 / ${embed.paddingPct}`, overflow: "hidden" }}
      />
    </Suspense>
  );
}
