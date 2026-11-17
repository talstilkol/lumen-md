/**
 * Plan W13.Y5 — the four criteria WCAG 2.2 added (and EN 301 549 v4.1.1
 * adopted) that axe mostly can't check, as tests:
 *
 *   2.5.8 Target Size (Minimum)   the 24 px rule with its spacing exception (src/__tests__/helpers/wcag22.ts)
 *   2.5.7 Dragging Movements      every drag has a single-pointer alternative: tabs (a menu), the sidebar edge (a click)
 *   2.4.11 Focus Not Obscured     notifications move away from the focused control
 *   3.3.8 Accessible Authentication   unlocking E2EE: paste and password managers allowed, a passkey or recovery key instead
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h, Fragment } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TARGET_MIN, undersizedTargets, focusObscured } from "./helpers/wcag22";
import { DocTabs } from "../ui/DocTabs";
import { CLICK_WIDTHS, nextClickWidth, SidebarResizer } from "../ui/SidebarResizer";
import { AiToastContainer, overlaps, showAiToast } from "../ui/AiToast";

const SRC = resolve(__dirname, "..");
afterEach(() => cleanup());

describe("2.5.8 Target Size (Minimum)", () => {
  const box = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h });
  it("24 × 24 passes; smaller passes only with room for a 24 px circle", () => {
    expect(undersizedTargets([box(0, 0, 24, 24), box(24, 0, 24, 24)])).toEqual([]);
    // Two 16 px icons 4 px apart: their circles overlap.
    expect(undersizedTargets([box(0, 0, 16, 16), box(20, 0, 16, 16)])).toEqual([0, 1]);
    // The same icons 30 px apart (centre to centre ≥ 24): fine.
    expect(undersizedTargets([box(0, 0, 16, 16), box(30, 0, 16, 16)])).toEqual([]);
    // A small target next to a big one: its circle may not reach the big one.
    expect(undersizedTargets([box(0, 0, 16, 16), box(18, 0, 40, 24)])).toEqual([0]);
    expect(TARGET_MIN).toBe(24);
  });

  it("the tab strip's controls are at least 24 px: tab close buttons and the new tab menu's items", () => {
    render(h(DocTabs, { tabs: [{ id: "a", name: "a.md" } as never, { id: "b", name: "b.md" } as never], activeId: "a", onSelect: () => {}, onClose: () => {}, onReorder: () => {} }));
    for (const b of screen.getAllByRole("button", { name: "Close tab" })) {
      expect(parseFloat(b.style.width)).toBeGreaterThanOrEqual(24);
      expect(parseFloat(b.style.height)).toBeGreaterThanOrEqual(24);
    }
    fireEvent.contextMenu(screen.getAllByRole("button", { name: /a\.md/ })[0].parentElement!);
    for (const item of screen.getAllByRole("menuitem")) expect(parseFloat(item.style.minHeight)).toBeGreaterThanOrEqual(24);
  });
});

describe("2.5.7 Dragging Movements: a single pointer, no drag", () => {
  const tabs = [{ id: "a", name: "a.md" }, { id: "b", name: "b.md" }, { id: "c", name: "c.md" }] as never[];

  it("a tab moves with its menu (right-click → Move later / Move earlier)", () => {
    const onReorder = vi.fn();
    render(h(DocTabs, { tabs, activeId: "a", onSelect: () => {}, onClose: () => {}, onReorder }));
    const tabA = screen.getByRole("button", { name: /^a\.md/ });
    fireEvent.contextMenu(tabA.parentElement!);
    const menu = screen.getByRole("menu");
    expect(menu.getAttribute("aria-label")).toContain("a.md");
    // The first tab can't move earlier.
    expect(screen.getByRole("menuitem", { name: "Move earlier" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Move later" }));
    expect(onReorder).toHaveBeenCalledWith(0, 1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("the menu works by keyboard too: Escape closes it; Alt+Shift+→ moves a tab (← in right-to-left)", () => {
    const onReorder = vi.fn();
    const { container } = render(h(DocTabs, { tabs, activeId: "b", onSelect: () => {}, onClose: () => {}, onReorder }));
    const tabB = screen.getByRole("button", { name: /^b\.md/ });
    fireEvent.contextMenu(tabB.parentElement!);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.keyDown(tabB, { key: "ArrowRight", altKey: true, shiftKey: true });
    expect(onReorder).toHaveBeenLastCalledWith(1, 2);
    const strip = container.querySelector(".doc-tabs") as HTMLElement;
    strip.setAttribute("dir", "rtl");
    strip.style.direction = "rtl";
    fireEvent.keyDown(tabB, { key: "ArrowLeft", altKey: true, shiftKey: true });
    expect(onReorder).toHaveBeenLastCalledWith(1, 2);
    fireEvent.keyDown(tabB, { key: "ArrowRight", altKey: true, shiftKey: true });
    expect(onReorder).toHaveBeenLastCalledWith(1, 0);
  });

  it("the sidebar edge: a click without dragging steps to the next width", () => {
    expect(nextClickWidth(240)).toBe(320);
    expect(nextClickWidth(400)).toBe(160);
    expect(nextClickWidth(250)).toBe(320);
    expect([...CLICK_WIDTHS]).toEqual([160, 240, 320, 400]);
    document.documentElement.style.setProperty("--sidebar-width", "240px");
    render(h(SidebarResizer));
    const edge = screen.getByRole("separator");
    fireEvent.pointerDown(edge, { clientX: 100, button: 0, pointerType: "mouse" });
    act(() => {
      window.dispatchEvent(new Event("pointerup"));
    });
    expect(document.documentElement.style.getPropertyValue("--sidebar-width")).toBe("320px");
    expect(edge.getAttribute("title")).toMatch(/click/i);
  });
});

describe("2.4.11 Focus Not Obscured: notifications move away", () => {
  it("overlap is exact: touching edges don't count", () => {
    expect(overlaps({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 5, top: 5, right: 20, bottom: 20 })).toBe(true);
    expect(overlaps({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 10, top: 0, right: 20, bottom: 10 })).toBe(false);
  });

  it("a toast's dismiss button is a 24 px target (2.5.8)", () => {
    render(h(AiToastContainer));
    act(() => showAiToast("Saved"));
    const x = screen.getByTestId("toast-dismiss");
    expect(parseFloat(x.style.minWidth)).toBeGreaterThanOrEqual(24);
    expect(parseFloat(x.style.minHeight)).toBeGreaterThanOrEqual(24);
  });

  it("a toast over the focused control moves to the top of the window", () => {
    render(h(Fragment, null, h("button", { type: "button" }, "Save"), h(AiToastContainer)));
    act(() => showAiToast("Saved"));
    const status = screen.getByTestId("toasts-status");
    expect(status.dataset.placement).toBe("bottom");
    // The toasts' corner and the focused button share pixels (layout is mocked: no layout engine here).
    const rect = (l: number, t: number, r: number, b: number) => ({ left: l, top: t, right: r, bottom: b, x: l, y: t, width: r - l, height: b - t, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(status, "getBoundingClientRect").mockReturnValue(rect(800, 600, 1100, 700));
    vi.spyOn(screen.getByTestId("toasts-alert"), "getBoundingClientRect").mockReturnValue(rect(0, 0, 0, 0));
    const save = screen.getByRole("button", { name: "Save" });
    vi.spyOn(save, "getBoundingClientRect").mockReturnValue(rect(900, 650, 980, 680));
    act(() => save.focus());
    expect(status.dataset.placement).toBe("top");
  });

  it("focusObscured: a control entirely under a fixed bar is obscured; one in the open is not", () => {
    document.body.innerHTML = `<button id="b">x</button><div id="bar" style="position:fixed"></div>`;
    const b = document.getElementById("b")!;
    const bar = document.getElementById("bar")!;
    vi.spyOn(b, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 40, bottom: 30, width: 40, height: 30, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    const at = vi.fn(() => bar);
    (document as unknown as { elementFromPoint: typeof at }).elementFromPoint = at;
    expect(focusObscured(b)).toBe(true);
    at.mockReturnValue(b);
    expect(focusObscured(b)).toBe(false);
  });
});

describe("3.3.8 Accessible Authentication: unlocking an encrypted vault", () => {
  const FILES = ["sync/e2ee/ui", "sync/e2ee/roles/ui", "sync/e2ee/classroom", "ui/VaultUnlock.tsx", "ui/VaultEncryptionDialog.tsx", "components/AuthDialog.tsx"];
  const files = FILES.flatMap((f) => {
    const p = join(SRC, f);
    try {
      return readdirSync(p).filter((n) => n.endsWith(".tsx")).map((n) => join(p, n));
    } catch {
      return [p];
    }
  });

  it("checks the unlock screens (not vacuous)", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("no unlock field blocks paste, copy or drop (a password manager or a pasted recovery key must work)", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(/on(Paste|Copy|Cut|Drop)=\{[^}]*preventDefault/.test(src), f).toBe(false);
    }
  });

  it("every password field says what it is to password managers (current- or new-password), never autocomplete off", () => {
    let n = 0;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/<input\b/g)) {
        const tag = src.slice(m.index, src.indexOf("/>", m.index) + 2);
        if (!/type=("password"|\{[^}]*"password")/.test(tag)) continue;
        n++;
        // A field component passes it on: its prop may only be one of the two.
        if (/autoComplete=\{autoComplete\}/.test(tag)) {
          expect(src, f).toMatch(/autoComplete\?: "new-password" \| "current-password"/);
          continue;
        }
        expect(tag, f).toMatch(/autoComplete=(\{[^}]*(current-password|new-password)[^}]*\}|"(current-password|new-password)")/);
      }
    }
    expect(n).toBeGreaterThan(5);
  });

  it("unlocking a role vault fills from the password manager (current-password), creating one offers a new one", () => {
    const src = readFileSync(join(SRC, "sync/e2ee/roles/ui/RoleVaultPanel.tsx"), "utf8");
    expect(src).toMatch(/testid="role-unlock" existing/);
    expect(src).toMatch(/autoComplete=\{existing \? "current-password" : "new-password"\}/);
  });

  it("there is a way in without remembering anything: a passkey and a recovery key", () => {
    const ui = readdirSync(join(SRC, "sync/e2ee/ui"));
    expect(ui).toContain("PasskeyUnlock.tsx");
    expect(ui).toContain("RecoveryKit.tsx");
  });
});
