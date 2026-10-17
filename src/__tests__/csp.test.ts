/**
 * CSP alignment gate.
 *
 * The page is served with BOTH the <meta> CSP in index.html and the
 * response-header CSP (public/_headers, served as dist/_headers by both
 * Cloudflare Pages and Netlify; netlify.toml deliberately has no CSP). Browsers enforce every policy, so a host has to be allowed in
 * all of them — drift silently breaks shipped features (this is how the AI
 * providers, Drive sync and the WebGPU model download were blocked).
 *
 * Asserts:
 *  (a) index.html and public/_headers (and the connect-src of
 *      docker/nginx.conf) share the same connect-src host set;
 *  (b) every provider base URL constant in src/ai/*Provider.ts is allowed;
 *  plus Trusted Types / script-src invariants for the header policies.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { TRUSTED_TYPES_POLICY_NAMES } from "../lib/trustedTypes";

const ROOT = resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

type Policy = Map<string, string[]>;

function parsePolicy(csp: string): Policy {
  const out: Policy = new Map();
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const [name, ...values] = tokens;
    out.set(name.toLowerCase(), values);
  }
  return out;
}

function cspFromIndexHtml(): Policy {
  const m = read("index.html").match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i,
  );
  if (!m) throw new Error("index.html: CSP meta tag not found");
  return parsePolicy(m[1]);
}

function cspFromHeadersFile(): Policy {
  const m = read("public/_headers").match(/^\s*Content-Security-Policy:\s*(.+)$/m);
  if (!m) throw new Error("public/_headers: CSP header not found");
  return parsePolicy(m[1]);
}


function connectSrcFromNginx(): string[] {
  const m = read("docker/nginx.conf").match(/^\s*connect-src ([^;]+);/m);
  if (!m) throw new Error("docker/nginx.conf: connect-src not found");
  // The build-time placeholder for deployment worker origins isn't a host.
  return m[1].trim().split(/\s+/).filter((t) => t !== "__CSP_CONNECT_EXTRA__");
}

const POLICIES: Record<string, Policy> = {
  "index.html": cspFromIndexHtml(),
  "public/_headers": cspFromHeadersFile(),
};

const sorted = (xs: string[]) => [...new Set(xs)].sort();

/** CSP source-expression match for an absolute URL (subset of CSP3 §6.7.2). */
function sourceAllows(source: string, rawUrl: string): boolean {
  const url = new URL(rawUrl);
  if (source === "*") return /^(https?|wss?):$/.test(url.protocol);
  if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) return url.protocol === source.toLowerCase();
  const m = source.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:]+)(?::(\d+|\*))?(\/.*)?$/i);
  if (!m) return false;
  const [, scheme, wildcard, host, port, path] = m;
  if (scheme) {
    const upgraded =
      (scheme === "http" && url.protocol === "https:") ||
      (scheme === "ws" && url.protocol === "wss:");
    if (`${scheme}:` !== url.protocol && !upgraded) return false;
  } else if (url.protocol !== "https:" && url.protocol !== "http:") {
    return false;
  }
  if (wildcard) {
    if (!url.hostname.endsWith(`.${host}`)) return false;
  } else if (url.hostname !== host.toLowerCase()) {
    return false;
  }
  const defaultPort = url.protocol === "https:" || url.protocol === "wss:" ? "443" : "80";
  const urlPort = url.port || defaultPort;
  if (port === "*") {
    /* any */
  } else if (port) {
    if (port !== urlPort) return false;
  } else if (urlPort !== (scheme === "http" || scheme === "ws" ? "80" : defaultPort) && url.port) {
    return false;
  }
  if (path && path !== "/" && !url.pathname.startsWith(path)) return false;
  return true;
}

function connectAllows(policy: Policy, url: string): boolean {
  const list = policy.get("connect-src") ?? policy.get("default-src") ?? [];
  return list.some((s) => sourceAllows(s, url));
}

/** Base URL string constants declared in src/ai/*Provider.ts. */
function providerBaseUrls(): { file: string; url: string }[] {
  const dir = join(ROOT, "src", "ai");
  const out: { file: string; url: string }[] = [];
  for (const file of readdirSync(dir).filter((f) => /Provider\.ts$/.test(f))) {
    const text = readFileSync(join(dir, file), "utf8");
    const re = /^\s*(?:export\s+)?const\s+[A-Z][A-Z0-9_]*\s*=\s*["'`](https?:\/\/[^"'`$]+)["'`]/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) out.push({ file, url: m[1] });
  }
  return out;
}

describe("CSP alignment", () => {
  it("netlify.toml sets no CSP of its own (it would be enforced alongside dist/_headers)", () => {
    expect(read("netlify.toml")).not.toMatch(/Content-Security-Policy\s*=/);
  });

  it("(a) index.html and public/_headers share one connect-src set", () => {
    const sets = Object.entries(POLICIES).map(([name, p]) => {
      const list = p.get("connect-src");
      expect(list, `${name} has no connect-src`).toBeDefined();
      return [name, sorted(list!)] as const;
    });
    const [, reference] = sets[0];
    for (const [name, set] of sets) expect(set, name).toEqual(reference);
  });

  it("(a) docker/nginx.conf connect-src matches as well", () => {
    expect(sorted(connectSrcFromNginx())).toEqual(sorted(POLICIES["index.html"].get("connect-src")!));
  });

  it("(a) connect-src lists explicit hosts, not a blanket https:/http:/*", () => {
    for (const [name, p] of Object.entries(POLICIES)) {
      const list = p.get("connect-src")!;
      expect(list.filter((s) => s === "https:" || s === "http:" || s === "*"), name).toEqual([]);
    }
  });

  const urls = providerBaseUrls();

  it("finds the provider base URL constants (sanity)", () => {
    const hosts = urls.map((u) => new URL(u.url).host);
    expect(hosts).toEqual(
      expect.arrayContaining([
        "api.anthropic.com",
        "generativelanguage.googleapis.com",
        "api.mistral.ai",
        "localhost:11434",
      ]),
    );
  });

  it.each(urls.map((u) => [u.file, u.url]))(
    "(b) %s base URL %s is allowed by every connect-src",
    (_file, url) => {
      for (const [name, p] of Object.entries(POLICIES)) {
        expect(connectAllows(p, url), `${name} blocks ${url}`).toBe(true);
      }
    },
  );

  it("(b) other first-party endpoints the app fetches are allowed", () => {
    const endpoints = [
      "https://api.openai.com/v1/chat/completions", // llm.ts, transcribe, embeddings, fineTune
      "http://127.0.0.1:11434/api/tags", // Ollama via loopback IP
      "https://api.languagetool.org/v2/check",
      "https://kroki.io/plantuml/svg",
      "https://oauth2.googleapis.com/token",
      "https://www.googleapis.com/drive/v3/files",
      "https://api.dropboxapi.com/2/files/list_folder",
      "https://content.dropboxapi.com/2/files/upload",
      "https://github.com/login/device/code",
      "https://api.github.com/gists",
      "https://huggingface.co/mlc-ai/model/resolve/main/x.bin",
      "https://cdn-lfs.huggingface.co/repos/x",
      "https://cas-bridge.xethub.hf.co/x",
      "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/x.wasm",
    ];
    for (const [name, p] of Object.entries(POLICIES)) {
      for (const url of endpoints) expect(connectAllows(p, url), `${name} blocks ${url}`).toBe(true);
    }
  });

  it("no longer references unpkg (Leaflet CSS + model-viewer are self-hosted)", () => {
    for (const file of ["index.html", "public/_headers", "netlify.toml", "docker/nginx.conf"]) {
      expect(read(file), file).not.toContain("unpkg.com");
    }
  });
});

describe("vercel.json (production host) mirrors public/_headers", () => {
  type Rule = { source: string; headers: { key: string; value: string }[] };
  const rules = (JSON.parse(read("vercel.json")) as { headers: Rule[] }).headers;
  const global = rules.find((r) => r.source.includes("(?!playground-runner"))!;
  const fileHeaders = new Map(
    [...read("public/_headers").split("/*\n")[1].split("\n\n")[0].matchAll(/^\s+([\w-]+): (.+)$/gm)].map((m) => [m[1], m[2]]),
  );

  it("has a global rule that skips only the playground runner", () => {
    expect(global, "global header rule").toBeDefined();
    const re = new RegExp(`^${global.source}$`);
    expect(re.test("/")).toBe(true);
    expect(re.test("/notes/a")).toBe(true);
    expect(re.test("/playground-runner.html")).toBe(false);
  });

  it("sends the same security headers as public/_headers", () => {
    const keys = global.headers.map((h) => h.key).sort();
    expect(keys).toEqual([...fileHeaders.keys()].sort());
    for (const h of global.headers) {
      if (h.key !== "Content-Security-Policy") expect(h.value, h.key).toBe(fileHeaders.get(h.key));
    }
  });

  it("CSP equals public/_headers plus https://*.workers.dev in connect-src", () => {
    // Static headers can't take the build-time worker origins, so the
    // edge workers' default *.workers.dev hosts are allowed instead.
    const vercel = parsePolicy(global.headers.find((h) => h.key === "Content-Security-Policy")!.value);
    const file = cspFromHeadersFile();
    expect([...vercel.keys()].sort()).toEqual([...file.keys()].sort());
    for (const [name, values] of file) {
      const extra = name === "connect-src" ? ["https://*.workers.dev"] : [];
      expect(sorted(vercel.get(name)!), name).toEqual(sorted([...values, ...extra]));
    }
  });
});

describe("CSP script-src / Trusted Types invariants", () => {
  it("script-src is identical everywhere and has no 'unsafe-inline'", () => {
    const ref = sorted(POLICIES["index.html"].get("script-src")!);
    for (const [name, p] of Object.entries(POLICIES)) {
      const list = p.get("script-src")!;
      expect(list, name).not.toContain("'unsafe-inline'");
      expect(sorted(list), name).toEqual(ref);
    }
  });

  it("index.html has no inline executable <script> (only external + JSON data blocks)", () => {
    const html = read("index.html");
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    for (const [, attrs, body] of scripts) {
      const isData = /type="application\/(ld\+)?json"/i.test(attrs);
      const isExternal = /\bsrc=/.test(attrs) && body.trim() === "";
      expect(isData || isExternal, `inline script: <script${attrs}>`).toBe(true);
    }
    expect(html).not.toMatch(/\son[a-z]+="/i);
  });

  it.each(["public/_headers"])(
    "%s enforces Trusted Types and allows exactly the app's policy names",
    (file) => {
      const p = POLICIES[file];
      expect(p.get("require-trusted-types-for")).toEqual(["'script'"]);
      const tt = p.get("trusted-types")!;
      expect(tt).toContain("'allow-duplicates'");
      expect(sorted(tt.filter((x) => !x.startsWith("'")))).toEqual(sorted([...TRUSTED_TYPES_POLICY_NAMES]));
    },
  );
});
