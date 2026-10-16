/**
 * Side-effect module: installs the `lumen` + `default` Trusted Types
 * policies. Imported FIRST from src/main.tsx so the policies exist before
 * any library (React, mermaid, tldraw, prosemirror, …) touches a DOM sink.
 */
import { installTrustedTypesPolicies } from "./trustedTypes";

installTrustedTypesPolicies();
