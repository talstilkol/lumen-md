/**
 * Plugins (plan 11.2 part c): the first-party registry and the installed
 * plugins — install with the user's grants (every capability unticked by
 * default, each with the plugin's reason), install from a bundle file,
 * update, change permissions, disable, uninstall.
 *
 * Plugins run sandboxed (src/plugins/runtime): QuickJS for logic, UI as
 * data, no network unless an exact origin is granted. The earlier
 * gallery's in-process "community" plugins and simulated remote installs
 * are gone (11.2.6).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, Download, Search, ShieldAlert, Trash2, Upload } from "lucide-react";
import { t } from "../i18n";
import { log } from "../lib/logger";
import type { PluginBundle } from "../plugins/runtime/bundle";
import type { Capability } from "../plugins/runtime/manifest";
import type { InstalledPlugin, RegistryEntry } from "../plugins/runtime/installed";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Installed = typeof import("../plugins/runtime/installed");

/** What the install / permissions dialog is about. */
interface Pending {
  bundle: PluginBundle;
  sha256: string;
  trust: InstalledPlugin["trust"];
  source: InstalledPlugin["source"];
  /** Pre-ticked: the grants an installed plugin already has (update / edit). Empty for a new install. */
  granted: Capability[];
  mode: "install" | "update" | "permissions";
}

const box = { border: "1px solid hsl(var(--border))", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column" as const, gap: 6 };
const btn = { border: "1px solid hsl(var(--border-strong))", borderRadius: 6, padding: "4px 10px", background: "transparent", color: "inherit", cursor: "pointer", font: "inherit", display: "inline-flex", alignItems: "center", gap: 4 };
const primary = { ...btn, background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", border: "none" };

function newer(a: string, b: string): boolean {
  const pa = a.split(/[-+]/)[0].split(".").map(Number);
  const pb = b.split(/[-+]/)[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

function Consent({ pending, onDone, mod }: { pending: Pending; onDone: () => void; mod: Installed }) {
  const m = pending.bundle.manifest;
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(pending.granted));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      if (pending.mode === "permissions") await mod.setGrants(m.id, [...ticked]);
      else await mod.installPlugin(pending.bundle, { sha256: pending.sha256, trust: pending.trust, source: pending.source, grants: [...ticked] });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label={t("plugins.consent.title", { name: m.name })} data-testid="plugin-consent" style={{ ...box, background: "hsl(var(--bg))" }}>
      <strong dir="auto">{t("plugins.consent.title", { name: m.name })}</strong>
      <span style={{ fontSize: 12, opacity: 0.8 }} dir="auto">
        {m.name} {m.version} · {m.author} · {m.license}
      </span>
      {pending.trust === "unverified" && (
        <span role="alert" style={{ color: "hsl(var(--destructive, 0 70% 50%))", display: "flex", gap: 6, alignItems: "center" }}>
          <ShieldAlert size={14} aria-hidden /> {t("plugins.trust.unverified")}
        </span>
      )}
      <span style={{ fontSize: 12 }}>{m.capabilities.length ? t("plugins.consent.intro") : t("plugins.consent.none")}</span>
      {m.capabilities.map((c) => (
        <label key={c.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }} dir="auto">
          <input
            type="checkbox"
            data-capability={c.id}
            checked={ticked.has(c.id)}
            onChange={(e) => {
              const next = new Set(ticked);
              if (e.target.checked) next.add(c.id);
              else next.delete(c.id);
              setTicked(next);
            }}
          />
          <span>
            <code dir="ltr">{c.id}</code> — {c.reason}
            {c.id.startsWith("network:") && <em style={{ display: "block", fontSize: 11, opacity: 0.8 }}>{t("plugins.consent.network")}</em>}
          </span>
        </label>
      ))}
      {error && <span role="alert">{error}</span>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {m.capabilities.length > 0 && (
          <button type="button" style={btn} onClick={() => setTicked(new Set(m.capabilities.map((c) => c.id)))}>
            {t("plugins.consent.allowAll")}
          </button>
        )}
        <button type="button" style={primary} disabled={busy} onClick={() => void apply()} data-testid="plugin-consent-confirm">
          {pending.mode === "permissions" ? t("plugins.consent.save") : pending.mode === "update" ? t("plugins.action.update") : t("plugins.action.install")}
        </button>
        <button type="button" style={btn} onClick={onDone}>
          {t("plugins.consent.cancel")}
        </button>
      </div>
    </div>
  );
}

export function PluginGallery({ open, onClose }: Props) {
  const [mod, setMod] = useState<Installed | null>(null);
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    let live = true;
    let unsubscribe = () => undefined as void;
    void import("../plugins/runtime/installed").then(async (m) => {
      if (!live) return;
      setMod(m);
      const refresh = async () => {
        const list = await m.listInstalled();
        if (live) setInstalled(list);
      };
      unsubscribe = m.subscribeInstalled(() => void refresh());
      await refresh();
      try {
        const r = await m.fetchRegistry(ac.signal);
        if (live) setRegistry(r);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          log.warn("plugin registry failed", e);
          if (live) setError(t("plugins.error.registry"));
        }
      }
    });
    return () => {
      live = false;
      unsubscribe();
      ac.abort();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (pending) setPending(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, pending]);

  const q = search.trim().toLowerCase();
  const visible = useMemo(() => registry.filter((r) => !q || `${r.name} ${r.description} ${r.author}`.toLowerCase().includes(q)), [registry, q]);
  const fromFile = installed.filter((p) => p.source === "file" && !registry.some((r) => r.id === p.id));

  if (!open) return null;

  const begin = async (entry: RegistryEntry, mode: Pending["mode"]) => {
    if (!mod) return;
    setError(null);
    try {
      const { bundle, sha256, trust } = await mod.fetchRegistryBundle(entry);
      const prev = installed.find((p) => p.id === entry.id);
      setPending({ bundle, sha256, trust, source: "registry", granted: mode === "update" ? mod.carriedGrants(prev, bundle.manifest) : [], mode });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const loadFile = async (file: File) => {
    if (!mod) return;
    setError(null);
    try {
      const { parseBundle } = await import("../plugins/runtime/bundle");
      const bundle = parseBundle(await file.text());
      const { sha256, trust } = await mod.verifyBundle(bundle);
      const prev = installed.find((p) => p.id === bundle.manifest.id);
      setPending({ bundle, sha256, trust, source: "file", granted: prev ? mod.carriedGrants(prev, bundle.manifest) : [], mode: prev ? "update" : "install" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const editPermissions = (p: InstalledPlugin) => {
    if (!mod) return;
    const manifest = mod.manifestOf(p);
    setPending({ bundle: { manifestText: p.manifestText, manifest, main: p.main }, sha256: p.sha256, trust: p.trust, source: p.source, granted: p.grants, mode: "permissions" });
  };

  const row = (p: InstalledPlugin | undefined, entry: RegistryEntry | undefined) => {
    const manifest = p && mod ? mod.manifestOf(p) : undefined;
    const id = p?.id ?? entry!.id;
    const name = manifest?.name ?? entry!.name;
    const err = p && mod ? mod.startError(id) : undefined;
    return (
      <div key={id} style={box} data-plugin-row={id} data-installed={p ? "true" : "false"}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong dir="auto" style={{ flex: 1 }}>
            {name}
          </strong>
          {(p?.trust ?? (entry?.signature ? "signed" : "pinned")) !== "unverified" ? (
            <span title={t(`plugins.trust.${p?.trust ?? (entry?.signature ? "signed" : "pinned")}`)} style={{ display: "inline-flex" }}>
              <BadgeCheck size={14} aria-label={t(`plugins.trust.${p?.trust ?? (entry?.signature ? "signed" : "pinned")}`)} />
            </span>
          ) : (
            <span title={t("plugins.trust.unverified")} style={{ display: "inline-flex" }}>
              <ShieldAlert size={14} aria-label={t("plugins.trust.unverified")} />
            </span>
          )}
          <span style={{ fontSize: 11, opacity: 0.7 }}>{manifest?.version ?? entry?.version}</span>
        </div>
        <span dir="auto" style={{ fontSize: 12, opacity: 0.85 }}>
          {manifest?.description ?? entry?.description}
        </span>
        <span style={{ fontSize: 11, opacity: 0.7 }} dir="ltr">
          {(manifest ? manifest.capabilities.map((c) => c.id) : entry!.capabilities).join(" · ") || t("plugins.consent.none")}
        </span>
        {p && (
          <span style={{ fontSize: 11 }} data-testid="plugin-grants">
            {t("plugins.granted", { list: p.grants.length ? p.grants.join(", ") : "—" })}
          </span>
        )}
        {err && (
          <span role="alert" style={{ fontSize: 11 }}>
            {t("plugins.error.start", { error: err })}
          </span>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {!p && entry && (
            <button type="button" style={primary} onClick={() => void begin(entry, "install")} data-testid="plugin-install">
              <Download size={13} aria-hidden /> {t("plugins.action.install")}
            </button>
          )}
          {p && entry && newer(entry.version, manifest?.version ?? "0.0.0") && (
            <button type="button" style={primary} onClick={() => void begin(entry, "update")} data-testid="plugin-update">
              {t("plugins.action.updateTo", { version: entry.version })}
            </button>
          )}
          {p && (
            <>
              <label style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 12 }}>
                <input type="checkbox" checked={p.enabled} onChange={(e) => void mod?.setEnabled(p.id, e.target.checked)} data-testid="plugin-enabled" />
                {t("plugins.action.enabled")}
              </label>
              <button type="button" style={btn} onClick={() => editPermissions(p)} data-testid="plugin-permissions">
                {t("plugins.action.permissions")}
              </button>
              <button type="button" style={btn} onClick={() => void mod?.uninstallPlugin(p.id)} data-testid="plugin-uninstall">
                <Trash2 size={13} aria-hidden /> {t("plugins.action.uninstall")}
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="plugin-gallery-title" style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "hsl(var(--bg))", color: "hsl(var(--fg))", border: "1px solid hsl(var(--border))", borderRadius: 16, width: 760, maxWidth: "calc(100vw - 32px)", maxHeight: "min(820px, calc(100vh - 32px))", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid hsl(var(--border))", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div id="plugin-gallery-title" style={{ fontWeight: 700, fontSize: 16 }}>
              {t("plugins.title")}
            </div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>{t("plugins.subtitle", { installed: installed.length, available: registry.length })}</div>
          </div>
          <button type="button" style={btn} onClick={() => fileRef.current?.click()} data-testid="plugin-load-file">
            <Upload size={13} aria-hidden /> {t("plugins.action.loadFile")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.lumenplugin.json,application/json"
            style={{ display: "none" }}
            data-testid="plugin-file-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void loadFile(f);
            }}
          />
          <button type="button" style={btn} onClick={onClose} aria-label={t("pluginGallery.close")}>
            ×
          </button>
        </div>
        <div style={{ padding: 16, overflow: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ fontSize: 12, margin: 0, opacity: 0.8 }}>{t("plugins.safety")}</p>
          {pending && mod && <Consent pending={pending} mod={mod} onDone={() => setPending(null)} />}
          {error && (
            <div role="alert" style={{ fontSize: 12 }}>
              {error}
            </div>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Search size={14} aria-hidden />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("pluginGallery.search")} aria-label={t("pluginGallery.search")} style={{ flex: 1, font: "inherit", padding: 4 }} />
          </label>
          {visible.map((entry) =>
            row(
              installed.find((p) => p.id === entry.id),
              entry,
            ),
          )}
          {fromFile.length > 0 && <strong style={{ fontSize: 13 }}>{t("plugins.fromFiles")}</strong>}
          {fromFile.map((p) => row(p, undefined))}
        </div>
      </div>
    </div>
  );
}
