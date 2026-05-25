# Release Notes — Security & Stability Hardening (MD Editor)

## ✅ Implemented in this pass

- Added centralized sanitization with `DOMPurify` and policy checks for HTML/SVG flows.
- Hardened runtime blocks:
  - `LiveJsBlock` moved to Worker execution with timeout and structured log channel.
  - `HtmlPreviewBlock` now passes pre-sanitized `srcDoc` and shows a sanitizer warning state.
  - `MermaidBlock`, `GraphvizBlock`, and `PlantUMLBlock` now expose render state + optional timing metadata.
  - `LiveSvgBlock` and `Model3DBlock` now surface explicit safe/blocked status states.
- Added export hardening in `PrintExport` and CSP tightening in iframe preview path.
- `PrintExport` now adds popup-blocked fallback: אם `window.open` נחסם, הדפסה מתבצעת דרך fallback בטוח באותו tab עם איפוס אוטומטי אחרי הדפסה.
- HTML preview is now sanitized for every render and disables script execution by default, with explicit user opt-in when potentially unsafe patterns are detected.
- Added sanitizer regression coverage:
  - `src/__tests__/markupSanitizer.test.ts` expanded to 20+ cases.
  - `src/__tests__/urlSanitizer.test.ts` added for URL allow/block rules.
- Added caching retention caps for diagram render outputs (`Mermaid`, `Graphviz`, `PlantUML`).
- Added integration/e2e hardening coverage for dynamic blocks:
  - `src/__tests__/dynamicBlocks.integration.test.tsx`
  - `e2e/dynamic-blocks-hardening.spec.ts`
- Added release/runbook for commit and rollback sequence:
  - `FIX_RELEASE_RUNBOOK.md`.

## ⚠️ Known remaining scope

- End-to-end performance baselining dashboards are still optional future work (outside this fix track).
- No blockers remain in this hardening rollout.
