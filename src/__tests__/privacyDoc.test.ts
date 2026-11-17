// @vitest-environment node
/**
 * Plan W4.29 — the privacy policy matches the code: every route the privacy
 * ledger can record (src/ai/privacyLedger.ts and every module that records
 * through it) is mapped in PRIVACY.he.md (Hebrew, Amendment 13) and in
 * PRIVACY.md, by the exact name the ledger panel shows, and every ledger
 * category is named in both.
 *
 * A new route fails this test until it is documented: a new `reason` in the
 * ledger, a new module calling one of the ledger's recording APIs, or a new
 * category.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const DOCS = { "PRIVACY.he.md": read("PRIVACY.he.md"), "PRIVACY.md": read("PRIVACY.md") };

/** The modules that record into the ledger, each with the reasons it records. */
const RECORDERS: Record<string, (src: string) => string[]> = {
  // The rules, the endpoint routes and the recorders' fixed reasons; a
  // template reason is checked by its fixed start ("Plugin ", "Read aloud (").
  "src/ai/privacyLedger.ts": (src) => [
    ...[...src.matchAll(/reason: "([^"]+)"/g)].map((m) => m[1]),
    // A recorder's default reason (recordOnDeviceModel's "Runs on this device; nothing is sent").
    ...[...src.matchAll(/\breason = "([^"]+)"/g)].map((m) => m[1]),
    ...[...src.matchAll(/reason: `([^`$]+)\$\{/g)].map((m) => m[1]).filter((p) => !/^\s*$/.test(p)),
    /export const MONITORING_REASON = "([^"]+)"/.exec(src)![1],
    // Audit mode: what it calls a request no rule names (auditReason's fallback).
    /\?\.reason \?\? "([^"]+)"/.exec(src)![1],
  ],
  "src/research/clipper.ts": (src) => [/reason: "([^"]+)"/.exec(src)![1]],
  "src/agents/python/runner.ts": (src) => [/export const LEDGER_REASON = "([^"]+)"/.exec(src)![1]],
  "src/agents/network.ts": (src) => [/const reason = `([^`$]+)\$\{/.exec(src)![1]],
  "src/plugins/plantumlPolicy.ts": (src) => [/const REASON = "([^"]+)"/.exec(src)![1]],
  "src/ui/VoiceDictation.tsx": (src) => [...src.matchAll(/recordBrowserService\("[^"]+", "([^"]+)"\)/g)].map((m) => m[1]),
  // Records with MONITORING_REASON (above) and the desktop update check's fixed reason.
  "src/lib/sentryMonitor.ts": () => [],
  "src/desktop/updates.ts": () => [],
  "src/plugins/runtime/pluginHost.ts": () => [],
  // Network voices: the reason ("Read aloud (<lang>) …") is the ledger's own.
  "src/ai/tts.ts": () => [],
  // Jewish sources (plan W5.1): ledgerFetch with the ledger's own sefaria.org rule.
  "src/sources/sefaria/app.ts": () => [],
  // Calendar connections (plan W7.20): CalDAV and ICS, each with its own reason.
  "src/calendar/config.ts": (src) => [...src.matchAll(/\? "([^"]+)" : "([^"]+)"/g)].flatMap((m) => [m[1], m[2]]),
  // Standard.site publishing (W7.19): its fixed reason (the PDS and plc.directory rules are the ledger's).
  "src/publish/standardSite.ts": (src) => [/export const ATPROTO_REASON = "([^"]+)"/.exec(src)![1]],
  // Open sources (W7.24): each host under its source's reason; the gate itself records its callers' reasons.
  "src/sources/open/app.ts": (src) => [...src.matchAll(/reason: "([^"]+)"/g)].map((m) => m[1]),
  "src/sources/open/gate.ts": () => [],
  // Wikidata entity linking (W12.E10): ledgerFetch with the ledger's own www.wikidata.org rule.
  "src/ui/WikidataLink.tsx": () => [],
  // Signed plugin install (W10.B3): every registry download under its one fixed reason.
  "src/plugins/install.ts": (src) => [/const LEDGER_REASON = "([^"]+)"/.exec(src)![1]],
  // A remote MCP server's tool listing (W10.C2, #978): "MCP server <name>".
  "src/agents/mcp/registry.ts": (src) => [/reason: `([^`$]+)\$\{/.exec(src)![1]],
  // A plain WebDAV backup (R8-M2): recordPlainBackup, with the ledger's own fixed reason.
  "src/backup/start.ts": () => [],
  // W13.M5 document scanner: ML Kit (Play services) through recordBrowserService, its reason in docScanner.ts.
  "src/mobile/docScanActions.ts": () => [...read("src/mobile/docScanner.ts").matchAll(/ledger\.service\("[^"]+", "([^"]+)"\)/g)].map((m) => m[1]),
  // lumen:// link decisions (W13.S): no request; the ledger lists each allowed or refused link, the action only.
  "src/security/linkConfirm.ts": (src) => {
    const line = /const reason = how === "remembered" \? "([^"]+)" : how === "asked" \? `([^`$]+)\$\{[^}]+\}[^`]*` : "([^"]+)"/.exec(src)!;
    return [line[1], line[2], line[3]];
  },
  // R8-M1: Tectonic's package downloads for LaTeX to PDF, under its one fixed reason.
  "src/latex/tectonicDesktop.ts": (src) => [/export const TECTONIC_LEDGER_REASON = "([^"]+)"/.exec(src)![1]],
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "__tests__" && name !== "node_modules") walk(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$|\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const RECORDING_CALL = /\b(recordBrowserService|recordBlockedRequest|recordPluginRequest|recordAppUpdateCheck|recordSpeechVoice|recordSpeechRecognition|recordPlainBackup|guardedFetch|ledgerFetch)\(/;

describe("PRIVACY.he.md / PRIVACY.md map every privacy-ledger route (plan W4.29)", () => {
  it("every module that records into the ledger is known here", () => {
    const callers = walk(join(ROOT, "src"))
      .filter((f) => RECORDING_CALL.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")))
      .map((f) => relative(ROOT, f))
      .filter((f) => f !== "src/ai/privacyLedger.ts");
    const unknown = callers.filter((f) => !(f in RECORDERS));
    expect(unknown, "a new module records into the privacy ledger: add it to RECORDERS and document its route").toEqual([]);
  });

  const reasons = [...new Set(Object.entries(RECORDERS).flatMap(([file, get]) => get(read(file))))];

  it("finds the routes (the extraction itself works)", () => {
    expect(reasons.length).toBeGreaterThan(25);
    for (const r of ["OpenAI", "Model download (Hugging Face)", "Error report (Sentry / GlitchTip), content removed", "Plugin ", "Agent tool "]) expect(reasons).toContain(r);
  });

  for (const [doc, text] of Object.entries(DOCS)) {
    it(`${doc}: every route by the name the ledger shows`, () => {
      const missing = reasons.filter((r) => !text.includes(`\`${r.trimEnd()}`));
      expect(missing).toEqual([]);
    });

    it(`${doc}: every ledger category`, () => {
      const union = /export type LedgerCategory = ([^;]+);/.exec(read("src/ai/privacyLedger.ts"))![1];
      const categories = [...union.matchAll(/"([\w-]+)"/g)].map((m) => m[1]);
      expect(categories.length).toBeGreaterThanOrEqual(9);
      expect(categories.filter((c) => !text.includes(`\`${c}\``))).toEqual([]);
    });
  }

  /*
   * Plan W11.S11: every route has a consent record under the PPA's consent
   * guidance (25 Feb 2026), and the legal documents for the routes that
   * leave the device exist and say what the acceptance needs.
   */
  describe("consent records and the legal documents (plan W11.S11)", () => {
    interface ConsentRecord {
      id: string;
      routes: string[];
      category: string;
      recipients: string[];
      needsConsent: boolean;
      status: string;
      gap?: string;
      ppa2026: { activeOptIn: string; preTicked: boolean; namedRecipients: string[]; withdrawal: string; reconsentOnChange: string };
    }
    const register = JSON.parse(read("legal/consent-register.json")) as { format: string; records: ConsentRecord[] };
    const union = /export type LedgerCategory = ([^;]+);/.exec(read("src/ai/privacyLedger.ts"))![1];
    const categories = [...union.matchAll(/"([\w-]+)"/g)].map((m) => m[1]);

    it("100% of the ledger's routes map to a consent record, and every record names real routes", () => {
      const mapped = register.records.flatMap((r) => r.routes);
      expect(reasons.filter((r) => !mapped.includes(r)), "a ledger route has no consent record").toEqual([]);
      expect(mapped.filter((r) => !reasons.includes(r)), "a record names a route the ledger doesn't have").toEqual([]);
      expect(new Set(mapped).size).toBe(mapped.length);
      expect(mapped.length).toBe(reasons.length);
    });

    it("each record answers the guidance: active opt-in, nothing pre-ticked, named recipients, one-click withdrawal, re-consent", () => {
      expect(register.format).toBe("lumen-consent-register/1");
      for (const r of register.records) {
        expect(categories, r.id).toContain(r.category);
        expect(r.ppa2026.preTicked, r.id).toBe(false);
        expect(r.ppa2026.activeOptIn.length, r.id).toBeGreaterThan(10);
        expect(r.ppa2026.withdrawal.length, r.id).toBeGreaterThan(10);
        expect(r.ppa2026.reconsentOnChange.length, r.id).toBeGreaterThan(10);
        expect(r.ppa2026.namedRecipients.length, r.id).toBeGreaterThan(0);
        expect(r.ppa2026.namedRecipients, r.id).toEqual(r.recipients);
        expect(["meets", "alarm", "gap"], r.id).toContain(r.status);
        if (r.status !== "meets") expect(r.gap, r.id).toBeTruthy();
      }
    });

    it("a route that carries user content can be withdrawn with the one local-only switch", () => {
      const content = ["cloud-ai", "cloud-text", "research", "third-party", "monitoring", "plugin"];
      // The switch the records point to is the ledger's own local-only rule.
      expect(read("src/ai/privacyLedger.ts")).toMatch(/local-only/);
      for (const r of register.records.filter((x) => content.includes(x.category) && x.status === "meets")) expect(r.ppa2026.withdrawal, r.id).toContain("Local only");
    });

    const LEGAL = {
      ropa: read("docs/legal/ropa.md"),
      runbook: read("docs/legal/breach-runbook.he.md"),
      dpia: read("docs/legal/dpia-share-server.md"),
      decisions: read("docs/legal/eu-representative-dpo.md"),
      records: read("docs/legal/consent-records.md"),
    };

    it("ROPA (GDPR Art. 30): the relay, the share server and feedback, with the retention the code has", () => {
      for (const s of ["Art. 30", "vault-relay", "collab-server", "Feedback", "Retention", "Recipients", "Transfers"]) expect(LEGAL.ropa).toContain(s);
      // The retention it states is the code's default, so the record can't drift from it.
      const relayDays = /VAULT_RELAY_RETENTION_DAYS, (\d+)\)/.exec(read("sync-server/vault-relay.js"))![1];
      const collabDays = /retentionDays = (\d+),/.exec(read("sync-server/collab-server.mjs"))![1];
      expect(LEGAL.ropa).toContain(`${relayDays} days`);
      expect(LEGAL.ropa).toContain(`${collabDays} days`);
      expect(LEGAL.dpia).toContain(`${collabDays} days`);
    });

    it("the breach runbook (Hebrew): 72 hours, the Privacy Protection Authority, Art. 33 and 34, and a template", () => {
      for (const s of ["72 שעות", "הרשות להגנת הפרטיות", "סעיף 33", "סעיף 34", "תבנית דיווח", "זה לא ייעוץ משפטי"]) expect(LEGAL.runbook).toContain(s);
    });

    it("a DPIA for the share server and written decisions on an EU representative and a DPO", () => {
      for (const s of ["Art. 35", "Necessity and proportionality", "Risks", "Measures still required"]) expect(LEGAL.dpia).toContain(s);
      for (const s of ["Art. 27", "Decision:", "DPO", "Trigger to revisit", "Amendment 13"]) expect(LEGAL.decisions).toContain(s);
      expect(LEGAL.records).toContain("Re-consent");
    });

    it("all of them are in the legal review packet (W6.37)", () => {
      const packet = read("scripts/legal-packet.mjs");
      for (const f of ["legal/consent-register.json", "docs/legal/consent-records.md", "docs/legal/ropa.md", "docs/legal/dpia-share-server.md", "docs/legal/eu-representative-dpo.md", "docs/legal/breach-runbook.he.md"]) expect(packet, f).toContain(`"${f}"`);
    });
  });

  it("the Hebrew policy says it is not legal advice and asks for a lawyer's review", () => {
    expect(DOCS["PRIVACY.he.md"]).toContain("זה לא ייעוץ משפטי");
    expect(DOCS["PRIVACY.he.md"]).toContain("טל צריך לבקש מעורך דין");
    expect(DOCS["PRIVACY.he.md"]).toContain("הערכת השפעה על הפרטיות: שרת השיתוף (W4.8)");
  });
});

describe("PRIVACY.he.md: the share-server impact assessment matches #469's code (decision 2.46)", () => {
  const he = DOCS["PRIVACY.he.md"];
  const dpia = he.slice(he.indexOf("## הערכת השפעה על הפרטיות: שרת השיתוף (W4.8)"), he.indexOf("## יצירת קשר"));
  const exists = (rel: string) => {
    try {
      return statSync(join(ROOT, rel)).isFile();
    } catch {
      return false;
    }
  };

  it("states the three actions as done, by the code's own names, and no longer as owed", () => {
    expect(dpia).toContain("90 יום אחרי השינוי האחרון");
    expect(dpia).toContain("`COLLAB_RETENTION_DAYS` (ברירת מחדל 90");
    expect(dpia).toContain("`[observability] enabled = false`");
    expect(dpia).toContain("**רק חדרים מוצפנים**");
    expect(dpia).toContain("(קוד 4403)");
    expect(dpia).toContain("`COLLAB_E2EE_ONLY=1`");
    // The earlier version's open items are gone.
    expect(dpia).not.toContain("**פעולה נדרשת:**");
    expect(dpia).not.toContain("**להחליט:**");
    expect(dpia).not.toContain("ללא הגבלה כרגע");
    // Not more than the code: no public server is running yet.
    expect(dpia).toContain("אף שרת פומבי לא פועל");
  });

  it("the retention it states is the one the Worker and the Node server use, once #469 is in the tree", () => {
    const toml = "edge-workers/collab/wrangler.toml";
    if (!exists(toml)) return; // #469 not merged into this branch yet
    expect(/RETENTION_DAYS = "(\d+)"/.exec(read(toml))?.[1]).toBe("90");
    expect(read(toml)).toMatch(/\[observability\]\s*\nenabled = false/);
    expect(read("sync-server/collab-server.mjs")).toMatch(/retentionDays = 90/);
  });

  it("the English policy points to the assessment and says the same three things", () => {
    const en = DOCS["PRIVACY.md"];
    expect(en).toContain("encrypted rooms only, deleted 90 days after the last change, and no\nIP addresses in logs");
    expect(en).not.toContain("and a public share server (W4.8)");
  });
});
