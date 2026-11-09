import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SCRIPT = join(ROOT, "scripts", "vercel-ignore.sh");

/**
 * Vercel caps `ignoreCommand` at 256 characters and reads exit code 0 as
 * "skip the build". The real logic lives in scripts/vercel-ignore.sh; these
 * tests pin both the config contract and the script's decisions.
 */
describe("vercel.json ignoreCommand", () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as {
    ignoreCommand?: string;
  };

  it("stays within Vercel's 256-character limit", () => {
    expect(cfg.ignoreCommand).toBeTruthy();
    expect(cfg.ignoreCommand!.length).toBeLessThanOrEqual(256);
  });

  it("delegates to a script that exists in the repo", () => {
    expect(cfg.ignoreCommand).toBe("bash scripts/vercel-ignore.sh");
    expect(existsSync(SCRIPT)).toBe(true);
  });
});

describe("scripts/vercel-ignore.sh", () => {
  let repo: string;
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, stdio: ["ignore", "pipe", "pipe"] }).toString();

  /** Returns the script's exit code for a commit touching exactly `files`. */
  function decide(files: string[]): number {
    for (const f of files) {
      mkdirSync(join(repo, dirname(f)), { recursive: true });
      writeFileSync(join(repo, f), `// ${Math.random()}\n`, { flag: "a" });
      git("add", "-f", f);
    }
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", files.join(" "));
    try {
      execFileSync("bash", ["scripts/vercel-ignore.sh"], { cwd: repo, stdio: "ignore" });
      return 0;
    } catch (e) {
      return (e as { status?: number }).status ?? -1;
    }
  }

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "lumen-vercel-ignore-"));
    git("init", "-q");
    mkdirSync(join(repo, "scripts"), { recursive: true });
    cpSync(SCRIPT, join(repo, "scripts", "vercel-ignore.sh"));
    // Minimal src/ with one import that reaches outside src/, mirroring
    // src/research/citations.ts → edge-workers/research/extract.ts.
    mkdirSync(join(repo, "src", "research"), { recursive: true });
    mkdirSync(join(repo, "src", "__tests__"), { recursive: true });
    writeFileSync(
      join(repo, "src", "research", "citations.ts"),
      'import { normaliseForMatch } from "../../edge-workers/research/extract";\nexport { normaliseForMatch };\n',
    );
    writeFileSync(
      join(repo, "src", "__tests__", "w.test.ts"),
      'import w from "../../edge-workers/auth/worker";\nexport default w;\n',
    );
    git("add", "-A");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  const SKIP = 0;
  const BUILD = 1;

  it("skips docs-only and other-deployable-only changes", () => {
    expect(decide(["MASTER_PLAN.md"])).toBe(SKIP);
    expect(decide(["docs/src/content/docs/x.md"])).toBe(SKIP);
    expect(decide(["edge-workers/research/worker.ts"])).toBe(SKIP);
    expect(decide(["mcp-server/src/frontmatter.ts"])).toBe(SKIP);
    expect(decide([".github/workflows/ci.yml"])).toBe(SKIP);
    expect(decide(["sync-server/server.js"])).toBe(SKIP);
  });

  it("builds when a module outside src/ that src/ imports changes", () => {
    expect(decide(["edge-workers/research/extract.ts"])).toBe(BUILD);
  });

  it("does not treat test-only imports as app inputs", () => {
    expect(decide(["edge-workers/auth/worker.ts"])).toBe(SKIP);
  });

  it("builds for app inputs, including markdown served from public/", () => {
    expect(decide(["src/lib/x.ts"])).toBe(BUILD);
    expect(decide(["public/plugins/CONTEST.md"])).toBe(BUILD);
    expect(decide(["vercel.json"])).toBe(BUILD);
    expect(decide(["package-lock.json"])).toBe(BUILD);
    expect(decide(["docs/a.md", "src/lib/y.ts"])).toBe(BUILD);
  });

  it("builds when there is no parent commit to diff against", () => {
    git("checkout", "-q", "--orphan", "solo");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "root", "--allow-empty");
    let code = 0;
    try {
      execFileSync("bash", ["scripts/vercel-ignore.sh"], { cwd: repo, stdio: "ignore" });
    } catch (e) {
      code = (e as { status?: number }).status ?? -1;
    }
    expect(code).toBe(BUILD);
  });
});
