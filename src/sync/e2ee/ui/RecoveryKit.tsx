/**
 * The recovery kit (plan W11.S9, research R3.9): set up the recovery key
 * (W11.S8) as 24 BIP-39 words, with a printable PDF, and only after the
 * user typed three of the words back; and restore a vault from the words
 * when the passphrase is forgotten.
 *
 * The words appear on screen once. The key lives in this component's
 * memory until it is committed (a key change wraps it into the keyring) or
 * the user leaves; it is never written to the vault, the device state or
 * sync storage, and the PDF is a download made on this device, never sent.
 */
import { useMemo, useState, type FormEvent } from "react";
import { t } from "../../../i18n";
import "../strings";
import { explainError } from "../../../lib/userError";
import { parseRecoveryWords, RECOVERY_WORDS, toRecoveryWords, verifyPositions, bip39Word } from "../bip39";
import { newRecoveryKey } from "../recovery";
import { downloadRecoveryKit } from "../recoveryKit";
import { setUpRecovery } from "../engine";
import type { RekeyRequest, RekeyResult } from "../engineTypes";
import type { VaultKeys } from "../keys";
import { MIN_PASSPHRASE_LENGTH } from "./PassphraseForm";

const muted: React.CSSProperties = { fontSize: 12, color: "hsl(var(--fg-muted))" };
const errorStyle: React.CSSProperties = { fontSize: 12, color: "hsl(var(--danger))" };
const primary: React.CSSProperties = { padding: "6px 14px", border: "none", borderRadius: 6, background: "hsl(var(--accent))", color: "hsl(var(--accent-fg))", cursor: "pointer", justifySelf: "start" };
const field: React.CSSProperties = { width: "100%", padding: "6px 8px", border: "1px solid hsl(var(--border))", borderRadius: 6, background: "transparent", color: "inherit", font: "inherit" };
const mono: React.CSSProperties = { fontFamily: "JetBrains Mono, ui-monospace, monospace" };

export interface RecoveryEngine {
  keys(): VaultKeys;
  rekey(r: RekeyRequest): Promise<RekeyResult>;
}

type Step = { at: "intro" } | { at: "words"; key: Uint8Array; words: string[] } | { at: "verify"; key: Uint8Array; words: string[]; ask: number[] } | { at: "done" };

/** Set up (or replace) the recovery key: words, PDF, three words typed back, then the key change. */
export function RecoveryKitSetup({ engine, onDone, positions = verifyPositions }: { engine: RecoveryEngine; onDone?: () => void; positions?: () => number[] }) {
  const [step, setStep] = useState<Step>({ at: "intro" });
  const [typed, setTyped] = useState<string[]>(["", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasOne = !!engine.keys().ring?.recovery;

  async function begin() {
    setError(null);
    const key = newRecoveryKey();
    setStep({ at: "words", key, words: await toRecoveryWords(key) });
  }

  async function commit(e: FormEvent) {
    e.preventDefault();
    if (step.at !== "verify") return;
    const wrong = step.ask.filter((pos, i) => bip39Word(typed[i]) !== step.words[pos - 1]);
    if (wrong.length) return setError(t("e2ee.recovery.verifyWrong", { n: wrong.join(", ") }));
    setError(null);
    setBusy(true);
    try {
      await setUpRecovery(engine, step.key);
      step.key.fill(0);
      setStep({ at: "done" });
      onDone?.();
    } catch (err) {
      setError(explainError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="e2ee-recovery-title" style={{ display: "grid", gap: 8 }} data-testid="recovery-kit">
      <div id="e2ee-recovery-title" style={{ fontWeight: 700 }}>
        {t("e2ee.recovery.title")}
      </div>
      {step.at === "intro" && (
        <>
          <div style={muted}>{t(hasOne ? "e2ee.recovery.hasOne" : "e2ee.recovery.intro")}</div>
          <button type="button" style={primary} onClick={() => void begin()}>
            {t(hasOne ? "e2ee.recovery.replace" : "e2ee.recovery.start")}
          </button>
        </>
      )}
      {step.at === "words" && (
        <>
          <div style={muted}>{t("e2ee.recovery.writeDown", { n: RECOVERY_WORDS })}</div>
          <ol dir="ltr" data-testid="recovery-words" style={{ ...mono, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "2px 16px", margin: 0, paddingInlineStart: 28, fontSize: 14 }}>
            {step.words.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ol>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => downloadRecoveryKit({ words: step.words, vaultId: engine.keys().vaultId, created: new Date().toISOString().slice(0, 10) })}>
              {t("e2ee.recovery.pdf")}
            </button>
            <button type="button" style={primary} onClick={() => setStep({ at: "verify", key: step.key, words: step.words, ask: positions() })}>
              {t("e2ee.recovery.next")}
            </button>
          </div>
          <div style={muted}>{t("e2ee.recovery.pdfNote")}</div>
        </>
      )}
      {step.at === "verify" && (
        <form onSubmit={commit} style={{ display: "grid", gap: 8 }}>
          <div style={muted}>{t("e2ee.recovery.verify")}</div>
          {step.ask.map((pos, i) => (
            <label key={pos} style={{ display: "grid", gap: 4, fontSize: 13 }}>
              {t("e2ee.recovery.wordN", { n: pos })}
              <input
                dir="ltr"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={typed[i]}
                onChange={(e) => setTyped(typed.map((x, j) => (j === i ? e.target.value : x)))}
                style={{ ...field, ...mono }}
              />
            </label>
          ))}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => setStep({ at: "words", key: step.key, words: step.words })}>
              {t("e2ee.recovery.back")}
            </button>
            <button type="submit" style={primary} disabled={busy || typed.some((x) => !x.trim())}>
              {t("e2ee.recovery.finish")}
            </button>
          </div>
        </form>
      )}
      {step.at === "done" && (
        <div role="status" data-testid="recovery-done" style={muted}>
          {t("e2ee.recovery.done")}
        </div>
      )}
      {error && (
        <div role="alert" style={errorStyle}>
          {error}
        </div>
      )}
    </section>
  );
}

/** The passphrase is forgotten: the 24 words and a new passphrase. */
export function RecoveryRestore({ onRestore }: { onRestore: (key: Uint8Array, newPassphrase: string) => Promise<unknown> }) {
  const [words, setWords] = useState("");
  const [pass, setPass] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const count = useMemo(() => words.split(/[\s,;·]+/).filter(Boolean).length, [words]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = await parseRecoveryWords(words);
    if (!parsed.ok) return setError(parsed.reason === "count" ? t("e2ee.recovery.count", { n: RECOVERY_WORDS, got: count }) : parsed.reason === "unknown" ? t("e2ee.recovery.unknown", { n: (parsed.at ?? 0) + 1 }) : t("e2ee.recovery.check"));
    if ([...pass].length < MIN_PASSPHRASE_LENGTH) return setError(t("e2ee.setup.tooShort", { n: MIN_PASSPHRASE_LENGTH }));
    if (pass !== again) return setError(t("e2ee.setup.mismatch"));
    setError(null);
    setBusy(true);
    try {
      await onRestore(parsed.key, pass);
    } catch (err) {
      setError(explainError(err));
    } finally {
      parsed.key.fill(0);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-labelledby="e2ee-restore-title" style={{ display: "grid", gap: 8, maxWidth: 420 }} data-testid="recovery-restore">
      <div id="e2ee-restore-title" style={{ fontWeight: 700 }}>
        {t("e2ee.recovery.restoreTitle")}
      </div>
      <div style={muted}>{t("e2ee.recovery.restoreNote")}</div>
      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        {t("e2ee.recovery.words", { n: RECOVERY_WORDS })}
        <textarea dir="ltr" rows={4} autoComplete="off" autoCapitalize="none" spellCheck={false} value={words} onChange={(e) => setWords(e.target.value)} style={{ ...field, ...mono }} />
      </label>
      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        {t("e2ee.recovery.newPassphrase")}
        <input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} style={field} />
      </label>
      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        {t("e2ee.setup.repeat")}
        <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} style={field} />
      </label>
      {error && (
        <div role="alert" style={errorStyle}>
          {error}
        </div>
      )}
      <button type="submit" style={primary} disabled={busy || !words.trim() || !pass}>
        {t("e2ee.recovery.restore")}
      </button>
    </form>
  );
}
