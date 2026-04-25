interface Props {
  source: string;
}

interface Embed {
  src: string;
  /** Aspect ratio (height:width); defaults to 56.25 (16:9). */
  paddingPct: number;
  title: string;
  allow: string;
}

const ALLOW =
  "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen";

function parse(line: string): Embed | null {
  const url = line.trim();
  if (!url) return null;

  // YouTube
  let m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/);
  if (m) {
    return {
      src: `https://www.youtube-nocookie.com/embed/${m[1]}`,
      paddingPct: 56.25,
      title: "YouTube",
      allow: ALLOW,
    };
  }
  // Vimeo
  m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) {
    return {
      src: `https://player.vimeo.com/video/${m[1]}`,
      paddingPct: 56.25,
      title: "Vimeo",
      allow: ALLOW,
    };
  }
  // Loom
  m = url.match(/loom\.com\/share\/([\w]+)/);
  if (m) {
    return {
      src: `https://www.loom.com/embed/${m[1]}`,
      paddingPct: 56.25,
      title: "Loom",
      allow: ALLOW,
    };
  }
  // CodePen
  m = url.match(/codepen\.io\/([^/]+)\/pen\/([\w]+)/);
  if (m) {
    return {
      src: `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result&theme-id=dark`,
      paddingPct: 60,
      title: "CodePen",
      allow: ALLOW,
    };
  }
  // CodeSandbox
  m = url.match(/codesandbox\.io\/(?:s|p\/sandbox)\/([\w-]+)/);
  if (m) {
    return {
      src: `https://codesandbox.io/embed/${m[1]}?view=preview`,
      paddingPct: 65,
      title: "CodeSandbox",
      allow: ALLOW,
    };
  }
  // Figma
  if (/figma\.com\/(file|proto|design)\//.test(url)) {
    return {
      src: `https://www.figma.com/embed?embed_host=lumen&url=${encodeURIComponent(url)}`,
      paddingPct: 60,
      title: "Figma",
      allow: ALLOW,
    };
  }
  // Spotify
  m = url.match(/open\.spotify\.com\/(track|album|playlist|episode|show)\/([\w]+)/);
  if (m) {
    return {
      src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`,
      paddingPct: 40,
      title: "Spotify",
      allow: "encrypted-media",
    };
  }
  // Generic: just iframe the URL.
  if (/^https?:\/\//i.test(url)) {
    return {
      src: url,
      paddingPct: 60,
      title: "Embed",
      allow: ALLOW,
    };
  }
  return null;
}

export default function EmbedBlock({ source }: Props) {
  // Allow multi-line; render the first non-empty URL only.
  const url = source.split("\n").map((s) => s.trim()).find(Boolean) ?? "";
  const embed = parse(url);

  if (!embed) {
    return (
      <div className="chart-block" style={{ padding: "1rem" }}>
        <div style={{ color: "hsl(0 80% 60%)", fontSize: 13 }}>
          ⚠︎ Could not recognize the embed URL.
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
          Open ↗
        </a>
      </div>
      <div
        style={{
          position: "relative",
          paddingBottom: `${embed.paddingPct}%`,
          height: 0,
          overflow: "hidden",
        }}
      >
        <iframe
          src={embed.src}
          title={embed.title}
          loading="lazy"
          allow={embed.allow}
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-popups allow-presentation allow-forms"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            border: 0,
          }}
        />
      </div>
    </div>
  );
}
