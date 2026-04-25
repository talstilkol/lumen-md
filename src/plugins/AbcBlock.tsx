import { useEffect, useRef, useState } from "react";

let abcPromise: Promise<typeof import("abcjs")> | null = null;
async function getAbc() {
  if (!abcPromise) {
    abcPromise = import("abcjs") as Promise<typeof import("abcjs")>;
  }
  return abcPromise;
}

interface Props {
  source: string;
}

export default function AbcBlock({ source }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const abc = await getAbc();
        if (cancelled || !ref.current) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (abc as any).renderAbc(ref.current, source, {
          responsive: "resize",
          add_classes: true,
          paddingleft: 10,
          paddingright: 10,
        });
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (error) {
    return (
      <div className="mermaid-block">
        <div className="mermaid-error">⚠︎ ABC notation error:{"\n"}{error}</div>
      </div>
    );
  }
  return (
    <div className="chart-block">
      <div className="chart-block-header">
        <span>Music · ABC notation</span>
      </div>
      <div ref={ref} style={{ padding: "0.75rem", overflow: "auto" }} />
    </div>
  );
}
