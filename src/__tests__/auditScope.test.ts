import { describe, it, expect } from "vitest";
import { auditScope } from "../ui/auditScope";

describe("auditScope", () => {
  it("uses the SSO organization for org members", () => {
    expect(auditScope({ id: "user_01", orgId: "org_acme" })).toBe("org_acme");
  });
  it("falls back to the user id, then 'personal'", () => {
    expect(auditScope({ id: "user_01" })).toBe("user_01");
    expect(auditScope(null)).toBe("personal");
  });
});
