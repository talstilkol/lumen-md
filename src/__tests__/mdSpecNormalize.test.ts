/**
 * W1.2: the conformance suite's HTML normalizer (helpers/mdSpec.ts) compares
 * as commonmark-spec's test/normalize.py does. Trailing whitespace of the
 * whole fragment does not count, even when the HTML leaves an element open
 * and a DOM tree builder moves the newline inside it (examples 21, 31, 150).
 */
import { describe, it, expect } from "vitest";
import { domFragmentParser, normalizeHtml } from "./helpers/mdSpec";

const parse = domFragmentParser(document);

describe("conformance normalizer", () => {
  it("ignores the trailing newline after an element left open", () => {
    expect(normalizeHtml('<a href="/bar\\/)">\n', parse)).toBe(normalizeHtml('<a href="/bar\\/)">', parse));
    expect(normalizeHtml("<div>\n*hello*\n<foo><a>\n", parse)).toBe(normalizeHtml("<div>\n*hello*\n<foo><a>", parse));
  });

  it("still tells different text apart", () => {
    expect(normalizeHtml('<a href="x">y\n', parse)).not.toBe(normalizeHtml('<a href="x">\n', parse));
    expect(normalizeHtml("<pre><code>a\n</code></pre>", parse)).not.toBe(normalizeHtml("<pre><code>a</code></pre>", parse));
  });
});
