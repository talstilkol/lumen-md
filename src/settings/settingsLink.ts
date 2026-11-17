/**
 * Deep links into the settings (plan W13.E4): `lumen://settings/<id>` from
 * the desktop shell (the `lumen-deep-link` event, as the clipper uses) and
 * `#settings/<id>` in the address on the web. Opens the screen on the
 * setting's tab with its control focused (`lumen-open-settings` with
 * `{ tab, focus }`, App.tsx). Kept import-light: the listener is tiny, the
 * schema loads when a link arrives.
 */

const HASH = /^#settings(?:\/(.*))?$/;

async function open(id: string): Promise<boolean> {
  const { resolveSettingsTarget } = await import("./settingsSearch");
  const target = resolveSettingsTarget(id);
  if (!target) return false;
  window.dispatchEvent(new CustomEvent("lumen-open-settings", { detail: target }));
  return true;
}

/** The id of a `lumen://settings/…` link, or null (the same rule as settingsSearch.parseSettingsLink, without loading it). */
function idOf(url: string): string | null {
  const m = /^lumen:\/\/settings(?:\/([^?#]*))?(?:[?#].*)?$/i.exec(url.trim());
  if (!m) return null;
  try {
    return decodeURIComponent(m[1] ?? "").replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function startSettingsLinks(): () => void {
  const onDeep = (e: Event) => {
    const id = idOf(String((e as CustomEvent).detail ?? ""));
    if (id !== null) void open(id);
  };
  const onHash = () => {
    const m = HASH.exec(location.hash);
    if (!m) return;
    let id = "";
    try {
      id = decodeURIComponent(m[1] ?? "");
    } catch {
      return;
    }
    // The address forgets the link once it has opened, so a reload does not reopen it.
    void open(id).then((ok) => ok && history.replaceState(null, "", location.pathname + location.search));
  };
  window.addEventListener("lumen-deep-link", onDeep);
  window.addEventListener("hashchange", onHash);
  onHash();
  let offTauri: (() => void) | undefined;
  let stopped = false;
  if ("__TAURI_INTERNALS__" in window) {
    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen<string>("lumen-deep-link", (e) => onDeep(new CustomEvent("x", { detail: e.payload }))))
      .then((off) => (stopped ? off() : (offTauri = off)))
      .catch(() => undefined);
  }
  return () => {
    stopped = true;
    offTauri?.();
    window.removeEventListener("lumen-deep-link", onDeep);
    window.removeEventListener("hashchange", onHash);
  };
}
