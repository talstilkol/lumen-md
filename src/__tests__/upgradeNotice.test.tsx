import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const startCheckout = vi.fn(async () => {});
const openBillingPortal = vi.fn(async () => {});
vi.mock("../billing/checkout", () => ({ startCheckout, openBillingPortal }));

import { UpgradeNotice } from "../ui/UpgradeNotice";
import { __setEntitlementEndpointForTesting, useEntitlement } from "../billing/useEntitlement";
import { useAuth } from "../auth/useAuth";

afterEach(() => {
  cleanup();
  __setEntitlementEndpointForTesting(null);
  useEntitlement.setState({ entitlement: null });
  vi.clearAllMocks();
});

describe("UpgradeNotice actions", () => {
  it("offers no purchase action in self-hosted builds (billing not configured)", () => {
    render(<UpgradeNotice compact plan="team" message="x" />);
    expect(screen.queryByTestId("upgrade-action")).toBeNull();
  });

  it("starts Checkout for the plan that unlocks the feature, with the user's token", async () => {
    __setEntitlementEndpointForTesting("https://billing.test/entitlements");
    const provider = useAuth.getState().provider;
    useAuth.setState({ provider: { ...provider, getAccessToken: async () => "jwt-1" } });
    render(<UpgradeNotice compact plan="team" message="x" />);
    fireEvent.click(screen.getByTestId("upgrade-action"));
    await waitFor(() => expect(startCheckout).toHaveBeenCalledWith("team", "jwt-1"));
    expect(screen.queryByTestId("manage-billing")).toBeNull();
    useAuth.setState({ provider });
  });

  it("also offers Manage billing to an existing subscriber", async () => {
    __setEntitlementEndpointForTesting("https://billing.test/entitlements");
    useEntitlement.setState({ entitlement: { tier: "pro", status: "active" } });
    const provider = useAuth.getState().provider;
    useAuth.setState({ provider: { ...provider, getAccessToken: async () => "jwt-2" } });
    render(<UpgradeNotice plan="team" message="x" />);
    fireEvent.click(screen.getByTestId("manage-billing"));
    await waitFor(() => expect(openBillingPortal).toHaveBeenCalledWith("jwt-2"));
    useAuth.setState({ provider });
  });
});
