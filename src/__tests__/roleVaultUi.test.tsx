/**
 * W12.S4, the screens: the invite screen (link and QR, no name or e-mail),
 * the `#rolevault=` start-up path, the member list with roles and Revoke
 * (the app's own confirm dialog, then ACL and re-key), the one-time "this
 * vault is current" prompt and the personal-folder indicator, all behind
 * the sync.e2ee flag with the "not externally audited" notice.
 *
 * Real path: the real panel, the real role-vault library and engine, and the
 * real vault relay (edge-workers/vault-relay, in the Durable Object
 * simulation of ./helpers/roleRelay.ts, which runs the same module as
 * sync-server/vault-relay.js). Files and engine state are in memory.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { applyLocale } from "../i18n";
import { setFlag } from "../flags/flags";
import { fromB64u, fromUtf8 } from "../sync/e2ee/bytes";
import { memoryFiles } from "../sync/e2ee/localFiles";
import { memoryStateStore, type SyncStateStore } from "../sync/e2ee/state";
import { encodeQr, qrPath } from "../lib/qr";
import { KEYRING_NAME } from "../sync/e2ee/keyring";
import { memberProvider, parseInviteHash, type Invite } from "../sync/e2ee/roles/vault";
import { RoleRefusedError } from "../sync/e2ee/roles/provider";
import { RoleVaultPanel } from "../sync/e2ee/roles/ui/RoleVaultPanel";
import { folderFiles, memberRows, type RoleDeps } from "../sync/e2ee/roles/ui/controller";
import { memoryRecords, type RoleRecord } from "../sync/e2ee/roles/ui/records";
import { closeRoleVaults, joinFromHash, openRoleVaults } from "../sync/e2ee/roles/ui/open";
import { roleVaultLinkReturn } from "../sync/e2ee/roles/ui/launch";
import { workerRelay, type RelayHost } from "./helpers/roleRelay";
import { TEST_ITERATIONS } from "./helpers/e2ee";

const ROOT = resolve(__dirname, "..", "..");
const ORIGIN = "https://lumen-md.vercel.app";
const PASS = "correct horse battery staple";

/** One device: its own records, files and engine state, all on the same relay. */
function device(relay: RelayHost) {
  const states = new Map<string, SyncStateStore>();
  const files = memoryFiles();
  const records = memoryRecords();
  const deps: RoleDeps = {
    fetch: relay.fetch,
    local: () => files,
    stateStore: async (id) => {
      if (!states.has(id)) states.set(id, memoryStateStore());
      return states.get(id)!;
    },
    records,
    pbkdf2Iterations: TEST_ITERATIONS,
  };
  return { deps, files, records };
}

const panel = (relay: RelayHost, deps: RoleDeps, joining: Invite | "bad" | null = null, onClose: () => void = () => undefined) =>
  render(<RoleVaultPanel onClose={onClose} deps={deps} relay={relay.url} origin={ORIGIN} joining={joining} />);

async function seriousAxe(node: Element): Promise<string[]> {
  const r = await axe.run(node, { rules: { "color-contrast": { enabled: false } } });
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help}`);
}

/** The admin creates a vault and makes one invite; returns the link shown. */
async function adminWithInvite(relay: RelayHost, role: "reader" | "writer", personal: boolean) {
  const admin = device(relay);
  const view = panel(relay, admin.deps);
  fireEvent.click(screen.getByTestId("role-new"));
  fireEvent.change(screen.getByTestId("role-create-passphrase"), { target: { value: PASS } });
  fireEvent.click(screen.getByTestId("role-create-go"));
  await screen.findByTestId("role-invite", undefined, { timeout: 30_000 });
  fireEvent.click(screen.getByTestId(`role-invite-${role}`));
  if (personal) fireEvent.click(screen.getByTestId("role-invite-personal"));
  fireEvent.click(screen.getByTestId("role-invite-make"));
  const link = ((await screen.findByTestId("role-invite-link")) as HTMLInputElement).value;
  return { admin, view, link };
}

let relay: RelayHost;
beforeEach(async () => {
  localStorage.clear();
  applyLocale("en");
  setFlag("sync.e2ee", true);
  relay = await workerRelay();
});
afterEach(() => {
  closeRoleVaults();
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("role vault screens: invite, join, members, revoke", () => {
  it("the invite link and its QR carry the space and the admin's keys only: no name, no e-mail", async () => {
    const { view, link } = await adminWithInvite(relay, "writer", false);
    expect(screen.getAllByTestId("e2ee-unaudited").length).toBeGreaterThan(0);
    expect(link.startsWith(`${ORIGIN}/#rolevault=`)).toBe(true);
    const payload = JSON.parse(fromUtf8(fromB64u(link.split("#rolevault=")[1]!))) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["a", "ar", "id", "p", "r", "role", "s", "t", "v"]);
    expect(payload.role).toBe("writer");
    expect(link).not.toMatch(/@|%40|name|mail/i);
    // The QR is that link, nothing more.
    const svg = within(screen.getByTestId("role-invite-qr")).getByRole("img");
    expect(svg.querySelector("path")!.getAttribute("d")).toBe(qrPath(encodeQr(link, "M")));
    // No field on the screen asks for a name or an e-mail.
    expect(view.container.ownerDocument.querySelectorAll('input[type="email"], input[autocomplete="name"], input[autocomplete="email"]').length).toBe(0);
    expect(screen.getByTestId("role-invite-open").children.length).toBe(1);
  }, 60_000);

  it("a member joins from the link, the admin accepts, the member confirms once; the personal folder is shown", async () => {
    const { admin, view, link } = await adminWithInvite(relay, "reader", true);
    const member = device(relay);
    const invite = parseInviteHash(link.slice(ORIGIN.length + 1));
    const mv = panel(relay, member.deps, invite);
    const join = within(mv.container.ownerDocument.body).getAllByTestId("role-join").at(-1)!;
    expect(within(join).getByText(/This link invites this device as: Reader/)).toBeTruthy();
    fireEvent.click(within(join).getByTestId("role-join-go"));
    await screen.findByTestId("role-waiting", undefined, { timeout: 30_000 });
    const rec = (await member.records.list())[0] as Extract<RoleRecord, { kind: "member" }>;
    expect(rec.kind).toBe("member");

    // The admin's device: the request, with the invite's role, then Accept.
    const adminRoot = within(view.container);
    fireEvent.click(adminRoot.getByTestId("role-pending-check"));
    const row = await adminRoot.findByTestId("role-pending-row", undefined, { timeout: 30_000 });
    expect(row.textContent).toMatch(/asks to join as Reader/);
    fireEvent.click(within(row).getByRole("button"));
    await waitFor(() => expect(adminRoot.getAllByTestId("role-member").length).toBe(2), { timeout: 30_000 });
    const m = adminRoot.getAllByTestId("role-member").find((x) => x.dataset.role === "reader")!;
    expect(within(m).getByTestId("role-member-personal")).toBeTruthy();
    // The invite is used up.
    await waitFor(() => expect(adminRoot.queryByTestId("role-invite-open")).toBeNull());

    // The member's device: open, the one-time prompt, the personal-folder indicator.
    const memberRoot = within(mv.container);
    fireEvent.click(memberRoot.getByTestId("role-waiting-refresh"));
    await memberRoot.findByTestId("role-fresh", undefined, { timeout: 30_000 });
    expect(memberRoot.getByTestId("role-personal").textContent).toMatch(/Only you and the admin can read it/);
    fireEvent.click(memberRoot.getByTestId("role-fresh-confirm"));
    await waitFor(() => expect(memberRoot.queryByTestId("role-fresh")).toBeNull(), { timeout: 30_000 });
    expect(memberRoot.getByText(/You won't be asked again/)).toBeTruthy();

    // Opened again on the same device: not asked again (the engine kept the answer).
    mv.unmount();
    const again = panel(relay, member.deps);
    fireEvent.click(await within(again.container).findByRole("button", { name: /^Open Vault/ }));
    await within(again.container).findByTestId("role-personal", undefined, { timeout: 30_000 });
    expect(within(again.container).queryByTestId("role-fresh")).toBeNull();
    void admin;
  }, 120_000);

  it("Revoke asks in the app's dialog; Escape keeps the member; OK writes the ACL and re-keys", async () => {
    const { view, link } = await adminWithInvite(relay, "writer", false);
    const member = device(relay);
    const mv = panel(relay, member.deps, parseInviteHash(link.slice(ORIGIN.length + 1)));
    fireEvent.click(within(mv.container).getByTestId("role-join-go"));
    await within(mv.container).findByTestId("role-waiting", undefined, { timeout: 30_000 });
    const adminRoot = within(view.container);
    fireEvent.click(adminRoot.getByTestId("role-pending-check"));
    fireEvent.click(within(await adminRoot.findByTestId("role-pending-row", undefined, { timeout: 30_000 })).getByRole("button"));
    await waitFor(() => expect(adminRoot.getAllByTestId("role-member").length).toBe(2), { timeout: 30_000 });
    const rec = (await member.records.list())[0] as Extract<RoleRecord, { kind: "member" }>;
    const prov = memberProvider(rec.ref, rec.keys, { fetch: relay.fetch });
    const epochBefore = (JSON.parse(new TextDecoder().decode((await prov.get(KEYRING_NAME))!.data)) as { epoch: number }).epoch;

    const revokeBtn = within(adminRoot.getAllByTestId("role-member").find((x) => x.dataset.role === "writer")!).getByTestId("role-member-revoke");
    expect(revokeBtn.getAttribute("aria-label")).toMatch(/^Revoke device /);
    revokeBtn.focus();
    fireEvent.click(revokeBtn);
    // The app's own dialog (ui/PromptDialog), not window.confirm; focus on its OK button.
    const dialog = await screen.findByText(/The relay refuses its changes from now on/);
    const box = dialog.closest("dialog")!;
    expect(box).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Revoke"));
    expect(box.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText(/The relay refuses its changes from now on/)).toBeNull());
    expect((await prov.acl(true)).members[rec.keys.id]?.role).toBe("writer");

    fireEvent.click(revokeBtn);
    const ok = within((await screen.findByText(/The relay refuses its changes from now on/)).closest("dialog")!).getByRole("button", { name: "Revoke" });
    fireEvent.click(ok);
    await adminRoot.findByText(/revoked\. The vault has a new key/, undefined, { timeout: 30_000 });
    const acl = await prov.acl(true);
    expect(acl.members[rec.keys.id]).toBeUndefined();
    expect(acl.revoked.map((r) => r.id)).toContain(rec.keys.id);
    const ring = JSON.parse(new TextDecoder().decode((await prov.get(KEYRING_NAME))!.data)) as { epoch: number; devices: Record<string, unknown> };
    expect(ring.epoch).toBeGreaterThan(epochBefore);
    expect(Object.keys(ring.devices)).not.toContain(rec.keys.id);
    // The relay refuses the revoked device's writes.
    await expect(prov.put("x-after-revoke", new Uint8Array([1]))).rejects.toBeInstanceOf(RoleRefusedError);
    const revokedRow = adminRoot.getAllByTestId("role-member").find((x) => x.dataset.member === rec.keys.id)!;
    expect(revokedRow.dataset.revoked).toBe("1");
    expect(within(revokedRow).queryByTestId("role-member-revoke")).toBeNull();
  }, 120_000);
});

describe("role vault screens: behind the flag, the start-up link", () => {
  it("with sync.e2ee off, a #rolevault= link opens the gate, not the panel; declining sends and keeps nothing", async () => {
    setFlag("sync.e2ee", false);
    history.replaceState(null, "", "/#rolevault=abc");
    openRoleVaults();
    joinFromHash(location.hash);
    expect(document.querySelector("[data-lumen-role-vaults]")).toBeNull();
    const done = roleVaultLinkReturn(Promise.resolve());
    const gate = await screen.findByTestId("e2ee-gate");
    expect(within(gate).getByTestId("e2ee-unaudited")).toBeTruthy();
    fireEvent.click(within(gate).getByTestId("e2ee-gate-cancel"));
    await done;
    expect(document.querySelector("[data-lumen-role-vaults]")).toBeNull();
    expect(location.hash).toBe("#rolevault=abc");
  });

  it("with the flag on, the link's fragment is dropped from the address and the join screen opens", async () => {
    const { link } = await adminWithInvite(relay, "reader", false);
    cleanup();
    const hash = link.slice(ORIGIN.length + 1);
    history.replaceState(null, "", `/${hash}`);
    await act(async () => joinFromHash(location.hash, device(relay).deps));
    expect(location.hash).toBe("");
    const host = document.querySelector("[data-lumen-role-vaults]")!;
    expect(within(host as HTMLElement).getByTestId("role-join")).toBeTruthy();
    expect(within(host as HTMLElement).getByTestId("e2ee-unaudited")).toBeTruthy();
  }, 60_000);

  it("a broken link shows a notice and nothing to join", async () => {
    history.replaceState(null, "", "/#rolevault=bm90LWpzb24");
    await act(async () => joinFromHash(location.hash, device(relay).deps));
    expect(screen.getByTestId("role-join-bad").textContent).toMatch(/broken or incomplete/);
    expect(screen.queryByTestId("role-join-go")).toBeNull();
  });

  it("an invite for another relay is refused before anything is sent", async () => {
    const { link } = await adminWithInvite(relay, "reader", false);
    cleanup();
    const invite = { ...parseInviteHash(link.slice(ORIGIN.length + 1)), relay: "https://evil.example" };
    const d = device(relay);
    panel(relay, d.deps, invite);
    expect(screen.getByRole("alert").textContent).toMatch(/another relay/);
    expect(screen.queryByTestId("role-join-go")).toBeNull();
    expect(await d.records.list()).toEqual([]);
  }, 60_000);
});

describe("role vault screens: accessibility and keyboard", () => {
  it("axe finds no serious or critical violation on the admin screen (invite with QR, members) and the join screen", async () => {
    const { view, link } = await adminWithInvite(relay, "writer", true);
    expect(await seriousAxe(view.container.ownerDocument.querySelector('[data-testid="role-vault"]')!)).toEqual([]);
    cleanup();
    const j = panel(relay, device(relay).deps, parseInviteHash(link.slice(ORIGIN.length + 1)));
    expect(await seriousAxe(j.container.ownerDocument.querySelector('[data-testid="role-vault"]')!)).toEqual([]);
  }, 60_000);

  it("is a <Modal>: Escape closes it, and Tab stays inside", async () => {
    let closed = 0;
    const d = device(relay);
    panel(relay, d.deps, null, () => closed++);
    const dialog = document.querySelector("dialog")!;
    expect(dialog.getAttribute("aria-labelledby")).toBe("role-vault-title");
    const tabbable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")];
    expect(tabbable.length).toBeGreaterThanOrEqual(3);
    tabbable.at(-1)!.focus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    tabbable[0]!.focus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(closed).toBe(1);
  });

  it("the passphrase form submits with Enter, and the role choice is a labelled radio group", async () => {
    const d = device(relay);
    panel(relay, d.deps);
    fireEvent.click(screen.getByTestId("role-new"));
    const input = screen.getByLabelText("Admin passphrase");
    fireEvent.change(input, { target: { value: PASS } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByTestId("role-invite", undefined, { timeout: 30_000 });
    const group = screen.getByRole("group", { name: "Role for this link" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["reader", "writer"]);
    expect((radios[0] as HTMLInputElement).checked).toBe(true);
    expect(within(group).getByRole("radio", { name: /Writer/ })).toBe(radios[1]);
  }, 60_000);
});

describe("role vault screens: pieces", () => {
  it("a role vault syncs into its own folder only", async () => {
    const inner = memoryFiles();
    inner.set("mine.md", "private");
    inner.set("Role vaults/ab12cd34/plan.md", "shared");
    const f = folderFiles(inner, "Role vaults/ab12cd34/");
    expect((await f.list()).map((x) => x.path)).toEqual(["plan.md"]);
    expect(await f.write("new.md", new TextEncoder().encode("x"), null)).toBe(true);
    expect(inner.text("Role vaults/ab12cd34/new.md")).toBe("x");
    expect(inner.text("new.md")).toBeUndefined();
  });

  it("member rows: admin, writers, readers, then the revoked", () => {
    const rows = memberRows({ v: 1, kind: "lumen-role-acl", space: "00", seq: 3, admin: "A", members: { r1: { role: "reader", scope: "p-x-" }, admin: { role: "admin" }, w1: { role: "writer" } }, revoked: [{ id: "w0", seq: 2, role: "writer" }] });
    expect(rows.map((r) => [r.id, r.role, r.personal, r.revoked])).toEqual([
      ["admin", "admin", false, false],
      ["w1", "writer", false, false],
      ["r1", "reader", true, false],
      ["w0", "writer", false, true],
    ]);
  });

  it("every e2ee.roles string is in all 8 locales, with the same placeholders", () => {
    const en = JSON.parse(readFileSync(join(ROOT, "src/i18n/lazy/e2ee.json"), "utf8")) as Record<string, string>;
    const keys = Object.keys(en).filter((k) => k.startsWith("e2ee.roles."));
    expect(keys.length).toBeGreaterThan(50);
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const lang of ["he", "ar", "de", "fr", "ja", "ru", "zh-CN"]) {
      const d = JSON.parse(readFileSync(join(ROOT, `src/i18n/locales/${lang}/common.json`), "utf8")) as Record<string, string>;
      const cmd = JSON.parse(readFileSync(join(ROOT, `src/i18n/locales/${lang}/cmd.json`), "utf8")) as Record<string, string>;
      expect(cmd["cmd.roleVault.open"], lang).toBeTruthy();
      for (const k of keys) {
        expect(d[k], `${lang} ${k}`).toBeTruthy();
        expect(vars(d[k]!), `${lang} ${k}`).toEqual(vars(en[k]!));
      }
    }
  });
});
