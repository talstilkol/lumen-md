/**
 * The model mode of the data-analysis harness (plan 6.15): the analyst
 * agent's own prompt, parser and validator (src/agents/defs/analyst.ts),
 * answered by a local Ollama model — temperature 0, seed 42, no thinking —
 * with the runtime's repair turn when the program breaks the contract
 * (one retry with the validator's hint, as maxRetries does in the app).
 *
 * Local only: the Ollama URL must be loopback. Every request carries an
 * AbortSignal (the caller's, and a per-request timeout).
 */

export function isLoopback(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "localhost" || h === "::1" || h === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(h);
  } catch {
    return false;
  }
}

/**
 * writeCode(question, csv, signal) → the program, for analyse() in
 * src/agents/analyst.ts. `def` is the analyst agent definition.
 */
export function ollamaWriteCode({ url = "http://127.0.0.1:11434", model, def, fetchImpl = fetch, timeoutMs = 180_000, retries = 1 }) {
  if (!model) throw new Error("set ANALYST_MODEL (an Ollama model tag, e.g. qwen2.5-coder:7b)");
  if (!isLoopback(url)) throw new Error(`the data-analysis model mode runs local models only: ${url} is not a loopback address`);
  return async (question, csv, signal) => {
    const messages = [
      { role: "system", content: def.system },
      { role: "user", content: def.user({ text: csv, extra: { question } }) },
    ];
    let last = "";
    for (let attempt = 0; attempt <= retries; attempt++) {
      const signals = [AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])];
      // privacy-ledger: the eval harness's Ollama on loopback, in Node (no ledger installed)
      const res = await fetchImpl(`${url.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, stream: false, think: false, options: { temperature: 0, seed: 42, num_predict: def.maxTokens ?? 1200 } }),
        signal: AbortSignal.any(signals),
      });
      if (!res.ok) throw new Error(`Ollama answered ${res.status}`);
      const body = await res.json();
      last = String(body?.message?.content ?? "");
      const code = def.parse(last);
      const failed = (def.validators ?? []).map((v) => v.check(code)).find((r) => r && r.ok === false);
      if (!failed) return code;
      messages.push({ role: "assistant", content: last }, { role: "user", content: `That program is not usable: ${failed.reason ?? failed.message ?? "it breaks the contract"}. ${failed.hint ?? ""} Write the whole program again.` });
    }
    throw new Error(`the model's program broke the contract ${retries + 1} times`);
  };
}
