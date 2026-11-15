/**
 * "Freshness not verified" (plan 3.4, step 9). A device that joined the
 * vault without pairing trusts the first manifest it saw (TOFU): it cannot
 * tell whether the provider showed it an old state. Until the user pairs it
 * with an existing device or confirms by hand, this banner says so — and
 * nothing in the UI claims rollback protection. Until then the device's
 * changes wait on it (third review 12.11, N6). Pairing is two-way by
 * default (N3): this device shows a request, an existing device checks it
 * against the vault as it is now and answers; a one-way code still works.
 * Either way the device is paired only after the user compared the five
 * symbols on both devices (plan W8.5, `PairingCompare`).
 */

import { useEffect, useState } from "react";
import { t } from "../../../i18n";
import { PairingEpochError, PairingError } from "../pairing";
import type { E2eeSync } from "../engine";
import { e2eeErrorText } from "./errorText";
import { PairingCompare } from "./PairingCompare";
import "../strings";
import { explainError } from "../../../lib/userError";

type Freshness = Awaited<ReturnType<E2eeSync["freshness"]>>;

/**
 * Review Z6-L4: how long the last answer stays on screen while a re-read after a round is out (ms). A re-read
 * answers well within it, so the line does not blink off and on with every auto-sync; one that does not answer
 * in time leaves freshness unknown, and "verified" goes.
 */
export const FRESHNESS_STALE_MS = 1_000;

interface Props {
  sync: Pick<E2eeSync, "freshness" | "pair" | "confirmFreshness" | "pairingRequest" | "pairingSas" | "confirmPairing" | "rejectPairing" | "onChange">;
  /** How often the comparison asks for the other device's key or confirmation (ms; tests). */
  pollMs?: number;
  /** FRESHNESS_STALE_MS (tests). */
  staleMs?: number;
}

export function FreshnessBanner({ sync, pollMs, staleMs = FRESHNESS_STALE_MS }: Props) {
  const [state, setState] = useState<Freshness | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<string | null>(null);
  /** The comparison under way (W8.5): a new key for each code or answer entered. */
  const [comparing, setComparing] = useState(0);

  useEffect(() => {
    let live = true;
    let reads = 0;
    let stale: ReturnType<typeof setTimeout> | undefined;
    // Re-read after every round, pairing or confirmation (2.31, #275): a round
    // can revoke a verification. A re-read that fails leaves freshness unknown,
    // and "verified" is never shown for an unknown state. Z6-L4: while the
    // re-read is out, the last answer stays for at most `staleMs`, then goes.
    const read = () => {
      const n = ++reads;
      clearTimeout(stale);
      stale = setTimeout(() => live && n === reads && setState((prev: Freshness | null) => (prev?.verified ? null : prev)), staleMs);
      const settle = (f: Freshness | null) => {
        if (!live || n !== reads) return;
        clearTimeout(stale);
        setState(f);
      };
      sync.freshness().then(settle, () => settle(null));
    };
    read();
    const off = sync.onChange(read);
    return () => {
      live = false;
      clearTimeout(stale);
      off();
    };
  }, [sync, staleMs]);

  async function act(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      // The change listener re-reads too; this answers at once.
      setState(await sync.freshness().catch(() => null));
    } catch (e) {
      // raw-error-allow: no raw text; e2eeErrorText names the known sync errors and falls back to explainError
      setError(e instanceof PairingEpochError && e.kind === "newer" ? t("e2ee.fresh.olderKeys") : e instanceof PairingError ? t("e2ee.fresh.badCode") : e2eeErrorText(e, "pair", explainError));
    }
  }

  if (!state) return null;
  if (state.verified) {
    return (
      <div role="status" style={{ fontSize: 12, color: "hsl(var(--fg-muted))" }}>
        {t("e2ee.fresh.verified")}
      </div>
    );
  }
  return (
    <div
      role="alert"
      style={{
        display: "grid",
        gap: 8,
        padding: "10px 12px",
        border: "1px solid hsl(var(--warning))",
        background: "hsl(var(--warning) / 0.1)",
        borderRadius: 8,
        fontSize: 13,
      }}
    >
      <div>{t("e2ee.fresh.unverified")}</div>
      <div>{t("e2ee.fresh.held")}</div>
      {request && (
        <label style={{ display: "grid", gap: 4 }}>
          {t("e2ee.fresh.requestHint")}
          <textarea
            readOnly
            value={request}
            dir="ltr"
            rows={3}
            onFocus={(e) => e.currentTarget.select()}
            style={{ padding: "4px 6px", border: "1px solid hsl(var(--border))", borderRadius: 6, background: "transparent", color: "inherit", fontFamily: "JetBrains Mono, ui-monospace, monospace", wordBreak: "break-all" }}
          />
        </label>
      )}
      <label style={{ display: "grid", gap: 4 }}>
        {t("e2ee.fresh.code")}
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          dir="ltr"
          spellCheck={false}
          style={{ padding: "4px 6px", border: "1px solid hsl(var(--border))", borderRadius: 6, background: "transparent", color: "inherit", fontFamily: "JetBrains Mono, ui-monospace, monospace" }}
        />
      </label>
      {error && <div style={{ color: "hsl(var(--danger))", fontSize: 12 }}>{error}</div>}
      {comparing > 0 && <PairingCompare key={comparing} sync={sync} pollMs={pollMs} onEnd={() => void sync.freshness().then(setState)} />}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() =>
            act(async () => {
              setComparing(0);
              setRequest(await sync.pairingRequest());
            })
          }
        >
          {t("e2ee.fresh.request")}
        </button>
        <button
          type="button"
          disabled={!code.trim()}
          onClick={() =>
            act(async () => {
              setComparing(0);
              await sync.pair(code);
              setComparing((n) => n + 1);
            })
          }
        >
          {t("e2ee.fresh.pair")}
        </button>
        <button type="button" disabled={state.counter === null} onClick={() => act(() => sync.confirmFreshness())}>
          {t("e2ee.fresh.confirm")}
        </button>
      </div>
    </div>
  );
}
