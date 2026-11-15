/**
 * Passkey unlock in the sync panel (plan W11.S10): add or remove a passkey
 * while unlocked, and unlock with one on the unlock screen. Both appear only
 * when the browser reports WebAuthn PRF support (`prfSupported`); otherwise
 * nothing is shown.
 */
import { useEffect, useState } from "react";
import { t } from "../../../i18n";
import "../strings";
import { explainError } from "../../../lib/userError";
import { browserWebAuthn, createPasskey, prfSupported, type WebAuthnApi } from "../passkey";
import { addPasskey, removePasskey } from "../engine";
import type { RekeyRequest, RekeyResult } from "../engineTypes";
import type { VaultKeys } from "../keys";

const muted: React.CSSProperties = { fontSize: 12, color: "hsl(var(--fg-muted))" };
const errorStyle: React.CSSProperties = { fontSize: 12, color: "hsl(var(--danger))" };

/** True once the browser has said it supports PRF; false until then and when it doesn't. */
export function usePrfSupported(api: WebAuthnApi | null): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let live = true;
    void prfSupported(api).then((v) => live && setOk(v));
    return () => {
      live = false;
    };
  }, [api]);
  return ok;
}

/** While unlocked: the vault's passkeys, add one, remove one. */
export function PasskeySetup({ engine, api = browserWebAuthn() }: { engine: { keys(): VaultKeys; rekey(r: RekeyRequest): Promise<RekeyResult> }; api?: WebAuthnApi | null }) {
  const supported = usePrfSupported(api);
  const [ids, setIds] = useState<string[]>(engine.keys().ring?.passkeys ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!supported) return null;
  const run = async (f: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await f();
      setIds(engine.keys().ring?.passkeys ?? []);
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="e2ee-passkey-title" style={{ display: "grid", gap: 6 }} data-testid="passkey-setup">
      <div id="e2ee-passkey-title" style={{ fontWeight: 700 }}>
        {t("e2ee.passkey.title")}
      </div>
      <div style={muted}>{t("e2ee.passkey.note")}</div>
      {ids.map((id, i) => (
        <div key={id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <span>{t("e2ee.passkey.item", { n: i + 1 })}</span>
          <button type="button" disabled={busy} onClick={() => void run(() => removePasskey(engine, id))}>
            {t("e2ee.passkey.remove")}
          </button>
        </div>
      ))}
      <button
        type="button"
        style={{ justifySelf: "start" }}
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const p = await createPasskey(engine.keys().vaultId, { api });
            await addPasskey(engine, p.id, p.prf);
            p.prf.fill(0);
          })
        }
      >
        {t("e2ee.passkey.add")}
      </button>
      {error && (
        <div role="alert" style={errorStyle}>
          {error}
        </div>
      )}
    </section>
  );
}

/** On the unlock screen: unlock with a passkey (any of the vault's). */
export function PasskeyUnlockButton({ onUnlock, api = browserWebAuthn() }: { onUnlock: (api: WebAuthnApi) => Promise<unknown>; api?: WebAuthnApi | null }) {
  const supported = usePrfSupported(api);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!supported || !api) return null;
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <button
        type="button"
        style={{ justifySelf: "start" }}
        disabled={busy}
        onClick={() => {
          setError(null);
          setBusy(true);
          void onUnlock(api).then(
            () => setBusy(false),
            (e) => {
              setBusy(false);
              setError(explainError(e));
            },
          );
        }}
      >
        {t("e2ee.passkey.unlock")}
      </button>
      {error && (
        <div role="alert" style={errorStyle}>
          {error}
        </div>
      )}
    </div>
  );
}
