/**
 * App lock and the task-switcher cover (plan W13.P1), as Apple Notes,
 * Standard Notes and 1Password do it:
 *
 *   - lock: after the app has been in the background for the chosen number
 *     of minutes (0 = at once), and on every cold start, the content is
 *     hidden behind a lock screen until the device's own check passes —
 *     Face ID / Touch ID / fingerprint / Windows Hello through the
 *     platform authenticator (WebAuthn, user verification required, nothing
 *     leaves the device), or the native plugin where there is one;
 *   - cover: the moment the app goes to the background the content is
 *     covered, so the task switcher's snapshot (iOS) shows the cover, not a
 *     note;
 *   - FLAG_SECURE (Android): while an encrypted vault is unlocked or the app
 *     lock is on, screenshots and the switcher card are blank
 *     (LumenPrivacy.setSecure, android/…/LumenPrivacyPlugin.java).
 *
 * This module is the state machine and the seams; ./appLockUi.tsx draws the
 * screens and ./appLockBoot.ts hides the content before the first paint.
 */

import { APP_LOCK_KEY } from "./appLockBoot";

export { APP_LOCK_KEY };
export const LOCK_DELAYS = [0, 1, 5, 15, 60] as const;
export type LockDelay = (typeof LOCK_DELAYS)[number];

export interface AppLockSettings {
  enabled: boolean;
  /** Minutes in the background before the lock (0: at once). */
  after: LockDelay;
  /** The platform credential the lock checks (WebAuthn), base64url. */
  credentialId?: string;
}

export const DEFAULT_SETTINGS: AppLockSettings = { enabled: false, after: 1 };

export function readSettings(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): AppLockSettings {
  try {
    const raw = JSON.parse(storage?.getItem(APP_LOCK_KEY) ?? "null") as Partial<AppLockSettings> | null;
    if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
    const after = LOCK_DELAYS.includes(raw.after as LockDelay) ? (raw.after as LockDelay) : DEFAULT_SETTINGS.after;
    return { enabled: raw.enabled === true, after, ...(typeof raw.credentialId === "string" ? { credentialId: raw.credentialId } : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(s: AppLockSettings, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(APP_LOCK_KEY, JSON.stringify(s));
  } catch {
    /* why: storage blocked — the lock stays as it was */
  }
}

/** The device check behind the lock. */
export interface BiometricSeam {
  /** A platform authenticator (Face ID, Touch ID, fingerprint, Windows Hello) is there. */
  available(): Promise<boolean>;
  /** Makes the credential the lock will ask for; returns its id. */
  enroll(): Promise<string>;
  /** True when the person passed the device's check. */
  verify(credentialId: string): Promise<boolean>;
}

/** The native plugin, where the app runs inside Capacitor (Android / iOS). */
export interface NativePrivacy {
  setSecure(o: { secure: boolean }): Promise<unknown>;
}

export type LockState = "unlocked" | "covered" | "locked";

export interface AppLockDeps {
  settings: () => AppLockSettings;
  seam: BiometricSeam;
  now: () => number;
  native?: NativePrivacy | null;
}

/**
 * The lock's state machine. `hidden()` when the app goes to the background,
 * `visible()` when it comes back, `unlock()` from the lock screen.
 */
export class AppLock {
  state: LockState = "unlocked";
  private hiddenAt: number | null = null;
  private vaultOpen = false;
  private listeners = new Set<(s: LockState) => void>();
  private failures = 0;

  constructor(private deps: AppLockDeps) {}

  /** Cold start: locked when the lock is on. */
  start(): LockState {
    if (this.deps.settings().enabled) this.set("locked");
    void this.syncSecure();
    return this.state;
  }

  onChange(fn: (s: LockState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(s: LockState): void {
    if (this.state === s) return;
    this.state = s;
    for (const l of this.listeners) l(s);
  }

  /** The app went to the background: cover it at once (the task switcher's snapshot sees the cover). */
  hidden(): void {
    if (this.hiddenAt === null) this.hiddenAt = this.deps.now();
    if (this.state === "unlocked") this.set("covered");
  }

  /** The app is back: lock if it was away long enough, else uncover. */
  visible(): LockState {
    const s = this.deps.settings();
    const away = this.hiddenAt === null ? 0 : this.deps.now() - this.hiddenAt;
    this.hiddenAt = null;
    if (this.state === "locked") return this.state;
    if (s.enabled && away >= s.after * 60_000) this.set("locked");
    else this.set("unlocked");
    return this.state;
  }

  lockNow(): void {
    if (this.deps.settings().enabled) this.set("locked");
  }

  /** The device check; true when it passed. Three failures in a row keep the lock and say so. */
  async unlock(): Promise<boolean> {
    const s = this.deps.settings();
    if (!s.enabled) {
      this.set("unlocked");
      return true;
    }
    let ok = false;
    try {
      ok = !!s.credentialId && (await this.deps.seam.verify(s.credentialId));
    } catch {
      ok = false;
    }
    if (ok) {
      this.failures = 0;
      this.set("unlocked");
    } else this.failures++;
    return ok;
  }

  get failedAttempts(): number {
    return this.failures;
  }

  /** An encrypted vault was unlocked or locked (session.ts events). */
  setVaultOpen(open: boolean): void {
    this.vaultOpen = open;
    void this.syncSecure();
  }

  /** FLAG_SECURE wanted: the app lock is on, or an encrypted vault is open. */
  get secureWanted(): boolean {
    return this.deps.settings().enabled || this.vaultOpen;
  }

  async syncSecure(): Promise<void> {
    try {
      await this.deps.native?.setSecure({ secure: this.secureWanted });
    } catch {
      /* why: no native window (browser, desktop): the cover still hides the content */
    }
  }
}

const b64url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/**
 * The platform authenticator through WebAuthn: a credential made on this
 * device and checked with user verification. No server: the challenge is
 * random and local, and nothing is sent anywhere — the browser and the OS
 * do the check.
 */
export function webAuthnSeam(nav: Navigator = navigator, crypto: Crypto = globalThis.crypto, rpName = "Lumen"): BiometricSeam {
  const pkc = (globalThis as { PublicKeyCredential?: { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> } }).PublicKeyCredential;
  return {
    async available() {
      try {
        return !!(await pkc?.isUserVerifyingPlatformAuthenticatorAvailable?.());
      } catch {
        return false;
      }
    },
    async enroll() {
      const cred = (await nav.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: rpName },
          user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "lumen-app-lock", displayName: rpName },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ],
          authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
          timeout: 60_000,
          attestation: "none",
        },
      })) as PublicKeyCredential | null;
      if (!cred) throw new Error("no credential");
      return b64url(cred.rawId);
    },
    async verify(credentialId) {
      const got = (await nav.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [{ type: "public-key", id: fromB64url(credentialId), transports: ["internal"] }],
          userVerification: "required",
          timeout: 60_000,
        },
      })) as PublicKeyCredential | null;
      const flags = got ? new Uint8Array((got.response as AuthenticatorAssertionResponse).authenticatorData)[32] : 0;
      // Bit 2 (UV): the device verified the person (biometric or device PIN), not just their presence.
      return !!got && (flags & 0x04) !== 0;
    },
  };
}
