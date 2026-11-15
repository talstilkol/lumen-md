/**
 * A parser for the OpenStep property lists Xcode writes (project.pbxproj):
 * dicts, arrays, strings; comments skipped. Shared by the iOS project tests.
 */
export type V = string | V[] | { [k: string]: V };

/** A parser for the OpenStep property lists Xcode writes: dicts, arrays, strings; comments skipped. */
export function parseOpenStep(text: string): V {
  let i = 0;
  const ws = () => {
    for (;;) {
      if (/\s/.test(text[i] ?? "")) i++;
      else if (text.startsWith("/*", i)) i = text.indexOf("*/", i) + 2;
      else if (text.startsWith("//", i)) i = text.indexOf("\n", i) + 1;
      else return;
    }
  };
  const str = (): string => {
    ws();
    if (text[i] === '"') {
      let out = "";
      i++;
      while (text[i] !== '"') {
        if (text[i] === "\\") i++;
        out += text[i++];
      }
      i++;
      return out;
    }
    const m = /^[A-Za-z0-9_$./:+\-<>]+/.exec(text.slice(i));
    if (!m) throw new Error(`unexpected ${JSON.stringify(text.slice(i, i + 20))} at ${i}`);
    i += m[0].length;
    return m[0];
  };
  const value = (): V => {
    ws();
    if (text[i] === "{") {
      i++;
      const d: Record<string, V> = {};
      for (;;) {
        ws();
        if (text[i] === "}") return i++, d;
        const k = str();
        ws();
        if (text[i++] !== "=") throw new Error(`= expected at ${i}`);
        if (k in d) throw new Error(`duplicate key ${k}`);
        d[k] = value();
        ws();
        if (text[i++] !== ";") throw new Error(`; expected at ${i}`);
      }
    }
    if (text[i] === "(") {
      i++;
      const a: V[] = [];
      for (;;) {
        ws();
        if (text[i] === ")") return i++, a;
        a.push(value());
        ws();
        if (text[i] === ",") i++;
      }
    }
    return str();
  };
  const v = value();
  ws();
  if (i < text.length) throw new Error(`trailing text at ${i}`);
  return v;
}

