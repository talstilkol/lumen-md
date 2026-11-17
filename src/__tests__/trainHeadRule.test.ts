/**
 * Review 12, M1: the decisions file's `trainHead` rule could never pass on a
 * pushed head, because the commit that records the head is itself on the
 * train. Now `trainHead` must be an ancestor of the train's head, and every
 * commit after it must be a non-merge commit touching only
 * plan/train-missing.json. Real git in a throwaway repository.
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
// @ts-expect-error — plain .mjs script without type declarations
import { DECISIONS_FILE, staleTrainHead } from "../../scripts/train-missing.mjs";

const tmp = mkdtempSync(join(tmpdir(), "train-head-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function repo() {
  const dir = join(tmp, `r${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, "plan"), { recursive: true });
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "t");
  const commit = (file: string, body: string) => {
    writeFileSync(join(dir, file), body);
    git("add", file);
    git("commit", "-q", "-m", file);
    return git("rev-parse", "HEAD");
  };
  return { dir, git, commit };
}
const T = "verify/train-7";

describe("trainHead: an ancestor, then only decision commits (review 12, M1)", () => {
  it("passes when only commits that touch the decisions file follow trainHead", () => {
    const r = repo();
    const decided = r.commit("src.txt", "code");
    r.commit(DECISIONS_FILE, JSON.stringify({ train: T, trainHead: decided }));
    const head = r.commit(DECISIONS_FILE, JSON.stringify({ train: T, trainHead: decided, decided: [1] }));
    expect(staleTrainHead({ train: T, trainHead: decided }, T, head, r.git)).toBeNull();
    expect(staleTrainHead({ train: T, trainHead: head }, T, head, r.git)).toBeNull();
  });

  it("fails when a commit after trainHead touches any other file", () => {
    const r = repo();
    const decided = r.commit("src.txt", "code");
    r.commit(DECISIONS_FILE, "{}");
    const head = r.commit("src.txt", "more code");
    expect(staleTrainHead({ train: T, trainHead: decided }, T, head, r.git)).toMatch(/touches src\.txt, not only plan\/train-missing\.json/);
  });

  it("fails when a merge follows trainHead, even one that only brings the decisions file", () => {
    const r = repo();
    const decided = r.commit("src.txt", "code");
    r.git("checkout", "-q", "-b", "side");
    r.commit(DECISIONS_FILE, "{}");
    r.git("checkout", "-q", "main");
    r.git("merge", "-q", "--no-ff", "-m", "merge", "side");
    const head = r.git("rev-parse", "HEAD");
    expect(staleTrainHead({ train: T, trainHead: decided }, T, head, r.git)).toMatch(/is a merge/);
  });

  it("fails when trainHead is not an ancestor of the head, or names another train", () => {
    const r = repo();
    r.commit("src.txt", "code");
    r.git("checkout", "-q", "-b", "other");
    const elsewhere = r.commit("x.txt", "x");
    r.git("checkout", "-q", "main");
    const head = r.commit(DECISIONS_FILE, "{}");
    expect(staleTrainHead({ train: T, trainHead: elsewhere }, T, head, r.git)).toMatch(/is not an ancestor/);
    expect(staleTrainHead({ train: "verify/train-6", trainHead: head }, T, head, r.git)).toMatch(/decided at verify\/train-6/);
  });
});
