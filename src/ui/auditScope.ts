import type { User } from "../auth/types";

/**
 * Audit-log scope for the signed-in user: their organization when the
 * session came from org SSO (WorkOS), otherwise their own id; "personal"
 * when signed out.
 */
export function auditScope(user: Pick<User, "id" | "orgId"> | null | undefined): string {
  return user?.orgId ?? user?.id ?? "personal";
}
