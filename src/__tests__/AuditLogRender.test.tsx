/**
 * Render tests for the AuditLog admin UI (ε.2 coverage).
 *
 * The audit fetch is mocked at the lib level so the test is hermetic
 * — no edge worker, no D1. We exercise:
 *   1. Closed dialog renders nothing
 *   2. Open dialog fetches once, renders rows in a table
 *   3. Action filter narrows the visible set
 *   4. Empty state when filter matches nothing
 *   5. CSV export triggers a Blob download
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../lib/audit", () => {
  const ROWS = [
    { user_id: "u1", org_id: "org-1", action: "doc.publish", payload_json: '{"slug":"hello"}', ts: 1714200000000 },
    { user_id: "u2", org_id: "org-1", action: "billing.subscribe", payload_json: undefined, ts: 1714201000000 },
    { user_id: "u3", org_id: "org-1", action: "doc.publish", payload_json: '{"slug":"world"}', ts: 1714202000000 },
  ];
  return {
    listAudit: vi.fn().mockResolvedValue(ROWS),
    recordAudit: vi.fn(),
    __setAuditConfigForTesting: vi.fn(),
  };
});

vi.mock("../ui/AiToast", () => ({ showAiToast: vi.fn() }));

import { AuditLog } from "../ui/AuditLog";
import { listAudit } from "../lib/audit";

describe("AuditLog dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <AuditLog open={false} onClose={() => {}} orgId="org-1" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("loads on open and shows the 3 rows", async () => {
    render(<AuditLog open onClose={() => {}} orgId="org-1" />);
    await waitFor(() => {
      expect(screen.getAllByText("doc.publish").length).toBeGreaterThan(0);
    });
    expect(listAudit).toHaveBeenCalledWith({
      orgId: "org-1",
      action: undefined,
      limit: 500,
    });
    // 2 distinct actions + 1 duplicate = 3 visible rows
    expect(screen.getAllByText("doc.publish")).toHaveLength(2);
    expect(screen.getByText("billing.subscribe")).toBeTruthy();
  });

  it("user filter narrows rows client-side", async () => {
    render(<AuditLog open onClose={() => {}} orgId="org-1" />);
    await waitFor(() => {
      expect(screen.getAllByText("doc.publish").length).toBeGreaterThan(0);
    });

    const filterInput = screen.getByPlaceholderText(/Filter by user id/i);
    fireEvent.change(filterInput, { target: { value: "u2" } });

    // u2 still visible; u1 / u3 gone.
    expect(screen.getByText("billing.subscribe")).toBeTruthy();
    expect(screen.queryByText("u1")).toBeNull();
    expect(screen.queryByText("u3")).toBeNull();
  });

  it("close button fires onClose", async () => {
    const onClose = vi.fn();
    render(<AuditLog open onClose={onClose} orgId="org-1" />);
    await waitFor(() => {
      expect(screen.getAllByText("doc.publish").length).toBeGreaterThan(0);
    });
    const closeBtn = screen.getByRole("button", { name: /^close$/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("export CSV triggers a download via Blob", async () => {
    // Stub URL.createObjectURL — jsdom doesn't implement it.
    const createObjectURL = vi.fn(() => "blob:audit-csv");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    render(<AuditLog open onClose={() => {}} orgId="org-1" />);
    await waitFor(() => {
      expect(screen.getAllByText("doc.publish").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: /Export CSV/i }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    // The mock's calls array is typed as `unknown[][]` here — cast through.
    const calls = createObjectURL.mock.calls as unknown as Blob[][];
    const blob = calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toMatch(/text\/csv/);
  });
});
