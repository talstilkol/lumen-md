/**
 * The vault screen (plan W13.M6): the vaults this device has opened, each
 * with where it is, notes, size, sync and plugins (from the cache, no vault
 * opened), a mark on one whose last opening never finished, and a menu:
 * Rename, Move (the open vault), Move to Recently deleted, Open in safe mode.
 * Recently deleted lists what can be restored for 30 days.
 *
 * Keyboard and screen readers: a native dialog (Modal); the list is a list,
 * each menu a real menu button (Arrow keys, Escape back to its button);
 * focus never drops to <body> after an action.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { getLocale, t } from "../i18n";
import { Modal } from "../ui/Modal";
import "../ui/PromptDialog.css";
import "./VaultPicker.css";
import "./vaultPickerStrings";
import { daysLeft, formatBytes, purgeExpired, readRegistry, rename, restore, trash, VaultPickerError, writeRegistry, type KV, type Registry, type VaultCard } from "./vaultRegistry";
import { kv, openVault } from "./vaultPickerActions";
import { explainError } from "../lib/userError";
import { EmptyState, learnHow } from "../ui/EmptyState";
import { HelpButton } from "../ui/HelpButton";

type Busy = null | { id: string; what: "rename" | "trash" | "restore" | "open" | "move" };

export function VaultPicker({ onClose, now = Date.now, openId: openIdProp, store = kv, open = openVault }: { onClose: () => void; now?: () => number; openId?: string | null; store?: KV; open?: typeof openVault }) {
  const [reg, setReg] = useState<Registry | null>(null);
  const [openId, setOpenId] = useState<string | null>(openIdProp ?? null);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const titleId = useId();
  const focusAfter = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void readRegistry(store).then((r) => {
      if (live) setReg(purgeExpired(r, now()));
    });
    if (openIdProp === undefined) void import("../storage/vault/identity").then((m) => live && setOpenId(m.activeVaultId()));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once
  }, []);

  // why: after a change the element that had focus may be gone; focus lands on the named control, never on <body>
  useEffect(() => {
    if (!focusAfter.current) return;
    const el = root.current?.querySelector<HTMLElement>(focusAfter.current);
    focusAfter.current = null;
    (el ?? root.current?.querySelector<HTMLElement>("h2"))?.focus();
  });

  const commit = async (next: Registry, message: string, focus: string) => {
    await writeRegistry(store, next);
    setReg(next);
    setStatus(message);
    setError(null);
    focusAfter.current = focus;
  };

  const run = async (b: NonNullable<Busy>, f: () => Promise<void>) => {
    setBusy(b);
    setMenu(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof VaultPickerError ? t(`vaults.error.${e.code}`) : explainError(e, "vault-picker"));
      focusAfter.current = `[data-card="${b.id}"] .vault-menu-button`;
    } finally {
      setBusy(null);
    }
  };

  if (!reg) return null;
  const locale = getLocale();
  const fmt = new Intl.NumberFormat(locale);

  const meta = (c: VaultCard) =>
    [c.files === null ? null : t("vaults.notes", { count: fmt.format(c.files) }), c.bytes === null ? null : `\u2066${formatBytes(c.bytes, locale)}\u2069`, c.sync ? t(`vaults.sync.${c.sync}`) : null, c.plugins === null ? null : t("vaults.plugins", { count: fmt.format(c.plugins) })]
      .filter(Boolean)
      .join(" · ");

  const menuKeys = (e: ReactKeyboardEvent<HTMLDivElement>, id: string) => {
    const items = [...(e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not([disabled])") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setMenu(null);
      focusAfter.current = `[data-card="${id}"] .vault-menu-button`;
    }
  };

  return (
    <Modal onClose={onClose} aria-labelledby={titleId} className="prompt-backdrop" data-testid="vault-picker">
      <div ref={root} className="prompt-dialog" style={{ color: "hsl(var(--fg))", inlineSize: "min(560px, calc(100vw - 24px))", maxBlockSize: "calc(100dvh - 24px)", overflow: "auto" }}>
        <span style={{ float: "inline-end", marginInlineStart: 8 }}><HelpButton topic="workspace/mobile-vault-folder" /></span>
        <h2 id={titleId} tabIndex={-1} data-autofocus style={{ fontSize: 18, fontWeight: 600, margin: "0 0 4px" }}>
          {t("vaults.title")}
        </h2>
        <p style={{ margin: "0 0 12px", fontSize: 13, opacity: 0.8 }}>{t("vaults.intro")}</p>
        <p role="status" aria-live="polite" style={{ margin: 0, fontSize: 13, minBlockSize: status ? undefined : 0 }}>
          {status}
        </p>
        {error && (
          <p role="alert" style={{ margin: "4px 0", fontSize: 13, fontWeight: 600, paddingInlineStart: 8, borderInlineStart: "3px solid hsl(0 70% 50%)" }}>
            {error}
          </p>
        )}
        {reg.vaults.length === 0 ? (
          <EmptyState style={{ padding: "8px 0", fontSize: 14 }} message={t("vaults.empty")} action={learnHow("workspace/mobile-vault-folder")} />
        ) : (
          <ul aria-label={t("vaults.title")} style={{ listStyle: "none", margin: "8px 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {reg.vaults.map((c) => {
              const isOpen = c.id === openId;
              const nameId = `vault-name-${c.id}`;
              return (
                <li key={c.id} data-card={c.id} aria-labelledby={nameId} style={{ border: "1px solid hsl(var(--border-strong))", borderRadius: 12, padding: 12, display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minInlineSize: 0 }}>
                    {renaming === c.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void run({ id: c.id, what: "rename" }, async () => {
                            const next = rename(reg, c.id, draft);
                            setRenaming(null);
                            await commit(next, t("vaults.renamed", { name: next.vaults.find((x) => x.id === c.id)!.name }), `[data-card="${c.id}"] .vault-menu-button`);
                          });
                        }}
                        style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
                      >
                        <label htmlFor={`rename-${c.id}`} className="sr-only">
                          {t("vaults.renameLabel")}
                        </label>
                        <input id={`rename-${c.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} dir="auto" autoFocus maxLength={120} style={{ flex: 1, minInlineSize: 120, padding: "4px 8px", border: "1px solid hsl(var(--border-strong))", borderRadius: 8, background: "hsl(var(--bg))", color: "hsl(var(--fg))" }} />
                        <button type="submit" className="prompt-btn prompt-btn-ok">
                          {t("vaults.save")}
                        </button>
                        <button
                          type="button"
                          className="prompt-btn prompt-btn-cancel"
                          onClick={() => {
                            setRenaming(null);
                            focusAfter.current = `[data-card="${c.id}"] .vault-menu-button`;
                          }}
                        >
                          {t("vaults.cancel")}
                        </button>
                      </form>
                    ) : (
                      <button type="button" className="vault-open" id={nameId} onClick={() => !isOpen && void run({ id: c.id, what: "open" }, async () => void (await open(c)))} disabled={isOpen || !!busy} aria-describedby={`vault-meta-${c.id}`} style={{ font: "inherit", fontWeight: 600, fontSize: 15, background: "none", border: 0, padding: 0, color: "inherit", textAlign: "start", cursor: isOpen ? "default" : "pointer" }}>
                        <bdi>{c.name}</bdi>
                        {isOpen && <span style={{ fontWeight: 400, fontSize: 12, marginInlineStart: 8, opacity: 0.8 }}>{t("vaults.open")}</span>}
                      </button>
                    )}
                    <div id={`vault-meta-${c.id}`} style={{ fontSize: 12, opacity: 0.85, marginBlockStart: 2 }}>
                      <div>
                        <bdi>{c.where}</bdi>
                      </div>
                      <div>{meta(c)}</div>
                      {c.failedLastOpen && (
                        <div role="note" data-testid="vault-failed" style={{ fontWeight: 600, marginBlockStart: 6, paddingInlineStart: 8, borderInlineStart: "3px solid hsl(35 90% 50%)" }}>
                          <span aria-hidden="true">⚠ </span>
                          {t("vaults.failedLastOpen")}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ position: "relative" }} onKeyDown={(e) => menu === c.id && menuKeys(e, c.id)}>
                    <button
                      type="button"
                      className="vault-folder-btn secondary vault-menu-button"
                      aria-haspopup="menu"
                      aria-expanded={menu === c.id}
                      aria-controls={menu === c.id ? `vault-menu-${c.id}` : undefined}
                      aria-label={t("vaults.menu", { name: c.name })}
                      onClick={() => {
                        setMenu(menu === c.id ? null : c.id);
                        focusAfter.current = menu === c.id ? null : `#vault-menu-${CSS.escape(c.id)} [role=menuitem]`;
                      }}
                    >
                      ⋯
                    </button>
                    {menu === c.id && (
                      <div id={`vault-menu-${c.id}`} role="menu" aria-label={t("vaults.menu", { name: c.name })} style={{ position: "absolute", insetInlineEnd: 0, insetBlockStart: "100%", zIndex: 2, background: "hsl(var(--bg))", border: "1px solid hsl(var(--border-strong))", borderRadius: 10, padding: 4, minInlineSize: 200, boxShadow: "0 8px 24px hsl(0 0% 0% / 0.2)" }}>
                        {c.failedLastOpen || !isOpen ? (
                          <button type="button" role="menuitem" className="vault-menu-item" onClick={() => void run({ id: c.id, what: "open" }, async () => void (await open(c, { safeMode: true })))}>
                            {t("vaults.safeMode")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          role="menuitem"
                          className="vault-menu-item"
                          onClick={() => {
                            setDraft(c.name);
                            setRenaming(c.id);
                            setMenu(null);
                          }}
                        >
                          {t("vaults.rename")}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="vault-menu-item"
                          disabled={!isOpen}
                          title={isOpen ? undefined : t("vaults.moveOpenFirst")}
                          onClick={() =>
                            void run({ id: c.id, what: "move" }, async () => {
                              const m = await import("../ui/vaultFolderActions");
                              await m.moveVaultToFolder();
                              setStatus(t("vaults.moved"));
                              focusAfter.current = `[data-card="${c.id}"] .vault-menu-button`;
                            })
                          }
                        >
                          {t("vaults.move")}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="vault-menu-item"
                          disabled={isOpen}
                          title={isOpen ? t("vaults.error.is-open") : undefined}
                          data-testid="vault-trash"
                          onClick={() => void run({ id: c.id, what: "trash" }, async () => commit(trash(reg, c.id, openId, now()), t("vaults.trashed", { name: c.name }), "#vault-trash-heading"))}
                        >
                          {t("vaults.trash")}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {reg.trash.length > 0 && (
          <section aria-labelledby="vault-trash-heading" style={{ marginBlockStart: 12 }}>
            <h3 id="vault-trash-heading" tabIndex={-1} style={{ fontSize: 14, fontWeight: 600, margin: "0 0 6px" }}>
              {t("vaults.trashTitle")}
            </h3>
            <p style={{ margin: "0 0 6px", fontSize: 12, opacity: 0.8 }}>{t("vaults.trashIntro")}</p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {reg.trash.map((c) => (
                <li key={c.id} data-trashed={c.id} style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", border: "1px dashed hsl(var(--border-strong))", borderRadius: 10, padding: 8 }}>
                  <span>
                    <bdi>{c.name}</bdi> <span style={{ fontSize: 12, opacity: 0.8 }}>· {t("vaults.daysLeft", { count: daysLeft(c, now()) })}</span>
                  </span>
                  <button type="button" className="vault-folder-btn secondary" data-testid="vault-restore" onClick={() => void run({ id: c.id, what: "restore" }, async () => commit(restore(reg, c.id), t("vaults.restored", { name: c.name }), `[data-card="${c.id}"] .vault-menu-button`))}>
                    {t("vaults.restore")}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBlockStart: 12 }}>
          <button type="button" className="prompt-btn prompt-btn-cancel" onClick={onClose}>
            {t("vaults.close")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
