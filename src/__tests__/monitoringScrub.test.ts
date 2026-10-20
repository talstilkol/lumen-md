/** Plan 12.4 — what an error report may carry: no note content, titles, paths or user data. */
import { describe, it, expect } from "vitest";
import type { ErrorEvent } from "@sentry/browser";
import { scrubEvent, scrubFilename, scrubText } from "../lib/monitoringScrub";

describe("scrubText", () => {
  it("removes quoted titles and note text", () => {
    expect(scrubText('Failed to save "Quarterly plan": quota exceeded')).toBe("Failed to save [redacted]: quota exceeded");
    expect(scrubText("Cannot rename 'secret.md' (exists)")).toBe("Cannot rename [redacted] (exists)");
    expect(scrubText("Unexpected token `## My diary`")).toBe("Unexpected token [redacted]");
  });

  it("removes paths, file names, e-mail addresses and long numbers", () => {
    expect(scrubText("ENOENT notes/private/diary.md")).toBe("ENOENT [path]");
    expect(scrubText("cannot read C:\\Users\\tal\\a.txt.")).toBe("cannot read [path].");
    expect(scrubText("open report.pdf, then retry")).toBe("open [file], then retry");
    expect(scrubText("mail tal@example.com id 12345678")).toBe("mail [email] id [number]");
  });

  it("removes words in other scripts (a Hebrew title) and keeps the app's English", () => {
    expect(scrubText("לא ניתן לשמור can't parse")).toBe("[text] [text] [text] can't parse");
  });

  it("caps the length", () => {
    expect(scrubText("x".repeat(1000)).length).toBeLessThanOrEqual(303);
  });
});

describe("scrubFilename", () => {
  it("keeps only a script's file name", () => {
    expect(scrubFilename("https://lumen-md.vercel.app/assets/app-AbC12.js?v=1#x")).toBe("app-AbC12.js");
    expect(scrubFilename("/Users/tal/My Notes/x.js")).toBe("x.js");
    expect(scrubFilename("file:///home/tal/יומן.md")).toBe("[file]");
    expect(scrubFilename(undefined)).toBeUndefined();
  });
});

describe("scrubEvent", () => {
  it("rebuilds the event from an allowlist", () => {
    const event = {
      type: undefined,
      event_id: "e1",
      level: "error",
      release: "lumen@0.1.0",
      message: 'Could not open "Diary"',
      request: { url: "https://lumen-md.vercel.app/#/notes/diary.md", headers: { Referer: "x" } },
      user: { id: "u1", ip_address: "1.2.3.4" },
      breadcrumbs: [{ message: "typed: my secret" }],
      tags: { doc: "diary.md" },
      extra: { note: "the body of my note" },
      contexts: { state: { doc: "the body" } },
      transaction: "/notes/diary.md",
      exception: {
        values: [
          {
            type: "Error",
            value: "write failed for notes/diary.md",
            mechanism: { type: "generic", handled: true, data: { path: "notes/diary.md" } },
            stacktrace: {
              frames: [{ filename: "https://lumen-md.vercel.app/assets/app-1.js", function: "save", lineno: 3, colno: 9, context_line: "const secret = 1", vars: { text: "body" }, abs_path: "/x/y" }],
            },
          },
        ],
      },
    } as unknown as ErrorEvent;
    const out = scrubEvent(event);
    expect(out).toEqual({
      type: undefined,
      event_id: "e1",
      level: "error",
      release: "lumen@0.1.0",
      message: "Could not open [redacted]",
      exception: {
        values: [
          {
            type: "Error",
            value: "write failed for [path]",
            mechanism: { type: "generic", handled: true },
            stacktrace: { frames: [{ filename: "app-1.js", function: "save", lineno: 3, colno: 9 }] },
          },
        ],
      },
    });
    expect(JSON.stringify(out)).not.toMatch(/diary|secret|body|1\.2\.3\.4|u1/);
  });
});
