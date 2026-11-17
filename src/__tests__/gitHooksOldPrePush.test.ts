/**
 * Review 12, L3: the ci:local pre-push hook became opt-in (review 11, M2),
 * but a clone where an older checkout had installed it automatically kept
 * running it on every push. `npm install` (scripts/install-git-hooks.mjs)
 * now removes our own pre-push hook when the clone has not opted in, but
 * only while it is exactly a text this repo wrote; an edited one, or anyone
 * else's, is kept.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs script without type declarations
import { installPlan, isOurUnchangedPrePush } from "../../scripts/install-git-hooks.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { hookPlan } from "../../scripts/lib/ciLocal.mjs";

const FIRST = "#!/bin/sh\n# installed by `npm run ci:local -- --install-hook` (plan 0.14); skip once with `git push --no-verify`\nexec npm run -s ci:local -- --changed --skip e2e --bail\n";
const NOW = hookPlan(null).content as string;
const pre = (existing: string | null, prePush = false) => installPlan({ "pre-push": existing, "reference-transaction": null }, { prePush }).find((s: { name: string }) => s.name === "pre-push");

describe("an old automatic pre-push hook of ours goes when the clone did not opt in (review 12, L3)", () => {
  it("removes either version of ours, unchanged; keeps an edited one and anyone else's; writes ours when opted in", () => {
    expect(isOurUnchangedPrePush(FIRST)).toBe(true);
    expect(isOurUnchangedPrePush(NOW)).toBe(true);
    expect(pre(FIRST).action).toBe("remove");
    expect(pre(NOW).action).toBe("remove");
    expect(pre(`${NOW}echo mine\n`).action).toBe("opt-in");
    expect(pre("#!/bin/sh\nmake check\n").action).toBe("opt-in");
    expect(pre(null).action).toBe("opt-in");
    expect(pre(FIRST, true).action).toBe("write");
    expect(pre(NOW, true).action).toBe("same");
  });
});
