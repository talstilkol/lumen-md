// TEMPORARY: CI job logs aren't readable from where this PR is written; surface failures as annotations.
import { beforeEach } from "vitest";
export function annotateFailures(): void {
  beforeEach((ctx) => {
    ctx.onTestFailed((c: unknown) => {
      const task = (c as { task?: { name?: string; result?: { errors?: { message?: string; stack?: string }[] } } }).task;
      const msg = (task?.result?.errors ?? []).map((e) => `${e.message ?? ""} ${(e.stack ?? "").split("\n").slice(1, 4).join(" | ")}`).join(" // ");
      const esc = (x: string) => x.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
      process.stdout.write(`\n::warning title=FAIL ${esc(task?.name ?? ctx.task.name)}::${esc(msg.slice(0, 3500))}\n`);
    });
  });
}
