/**
 * Organization admin panel (ε.1.3 / F4.4) — render tests across the
 * local-only, SSO-configured and SSO-connected states, plus the
 * entitlement gate on the audit-log link.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../ui/AiToast", () => ({ showAiToast: vi.fn() }));

import { OrgSettings } from "../ui/OrgSettings";
import { useAuth } from "../auth/useAuth";
import { localProvider } from "../auth/localProvider";
import { workosProvider, __setWorkOSConfigForTesting } from "../auth/workosProvider";
import { useEntitlement } from "../billing/useEntitlement";
import { loadOrgSettings, normalizeDomain, saveOrgSettings } from "../lib/orgSettings";
import { showAiToast } from "../ui/AiToast";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  __setWorkOSConfigForTesting(null);
  useAuth.setState({ status: "anonymous", user: null, provider: localProvider, error: undefined });
});
afterEach(() => {
  __setWorkOSConfigForTesting(null);
  localStorage.removeItem("lumen.dev.tier");
});

describe("orgSettings store", () => {
  it("normalises domains", () => {
    expect(normalizeDomain(" @Acme.COM ")).toBe("acme.com");
    expect(normalizeDomain("https://acme.co.uk/login")).toBe("acme.co.uk");
    expect(normalizeDomain("acme")).toBeNull();
    expect(normalizeDomain("a b.com")).toBeNull();
  });

  it("round-trips and drops junk from storage", () => {
    expect(saveOrgSettings({ name: " Acme ", domains: ["acme.com", "ACME.com", "bad"] })).toBe(true);
    expect(loadOrgSettings()).toEqual({ name: "Acme", domains: ["acme.com"] });
    localStorage.setItem("lumen.org.settings", "{not json");
    expect(loadOrgSettings()).toEqual({ name: "", domains: [] });
  });
});

describe("<OrgSettings />", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<OrgSettings open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("local-only: shows the local badge, SSO not configured and the connect-SSO empty state", () => {
    render(<OrgSettings open onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Organization" })).toBeTruthy();
    expect(screen.getByTestId("org-local-only")).toBeTruthy();
    expect(screen.getByTestId("org-sso-status").getAttribute("data-state")).toBe("notConfigured");
    expect(screen.getByText("SSO not configured")).toBeTruthy();
    expect(screen.getByTestId("org-auth-status").getAttribute("data-kind")).toBe("notConfigured");
    expect(screen.getByTestId("org-members-empty")).toBeTruthy();
    expect(screen.getByRole("link", { name: "How to connect SSO" }).getAttribute("href")).toContain("/account/sso/");
  });

  it("edits name + domains and saves to local storage", () => {
    render(<OrgSettings open onClose={() => {}} />);
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "Acme" } });
    const domainInput = screen.getByPlaceholderText("acme.com");
    fireEvent.change(domainInput, { target: { value: "not a domain" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert").textContent).toMatch(/acme\.com/);

    fireEvent.change(domainInput, { target: { value: "@Acme.com" } });
    fireEvent.keyDown(domainInput, { key: "Enter" });
    expect(screen.getByText("acme.com")).toBeTruthy();

    fireEvent.change(domainInput, { target: { value: "acme.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert").textContent).toMatch(/already in the list/);

    fireEvent.click(save);
    expect(loadOrgSettings()).toEqual({ name: "Acme", domains: ["acme.com"] });
    expect(showAiToast).toHaveBeenCalledWith("Organization settings saved", "success");

    fireEvent.click(screen.getByRole("button", { name: "Remove acme.com" }));
    expect(screen.queryByText("acme.com")).toBeNull();
  });

  it("SSO configured but signed out", () => {
    __setWorkOSConfigForTesting({ endpoint: "https://auth.example.test" });
    render(<OrgSettings open onClose={() => {}} />);
    expect(screen.getByTestId("org-sso-status").getAttribute("data-state")).toBe("configured");
  });

  it("SSO connected: lists the signed-in member, hides the local badge", () => {
    __setWorkOSConfigForTesting({ endpoint: "https://auth.example.test" });
    useAuth.setState({
      status: "authenticated",
      provider: workosProvider,
      user: { id: "prof_1", email: "ada@acme.com", name: "Ada Lovelace", provider: "workos", orgId: "org_01" },
    });
    render(<OrgSettings open onClose={() => {}} />);
    expect(screen.getByTestId("org-sso-status").getAttribute("data-state")).toBe("connected");
    expect(screen.getByText(/organization org_01/)).toBeTruthy();
    expect(screen.queryByTestId("org-local-only")).toBeNull();
    expect(screen.getByTestId("org-members").textContent).toContain("Ada Lovelace");
    expect(screen.getByTestId("org-auth-status").getAttribute("data-kind")).toBe("signedIn");
  });

  it("audit log link is open when billing isn't enforced and calls through", () => {
    const onClose = vi.fn();
    const onOpenAuditLog = vi.fn();
    render(<OrgSettings open onClose={onClose} onOpenAuditLog={onOpenAuditLog} />);
    fireEvent.click(screen.getByRole("button", { name: "Open audit log" }));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenAuditLog).toHaveBeenCalled();
  });

  it("audit log is gated behind the Team plan when gates are enforced", () => {
    useEntitlement.getState().setLocal("pro");
    render(<OrgSettings open onClose={() => {}} onOpenAuditLog={() => {}} />);
    expect(screen.queryByRole("button", { name: "Open audit log" })).toBeNull();
    expect(screen.getByTestId("upgrade-notice").textContent).toMatch(/Team plan/);
  });

  it("audit log is available on Team", () => {
    useEntitlement.getState().setLocal("team");
    render(<OrgSettings open onClose={() => {}} onOpenAuditLog={() => {}} />);
    expect(screen.getByRole("button", { name: "Open audit log" })).toBeTruthy();
  });
});
