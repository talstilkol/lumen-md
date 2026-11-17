/**
 * The privacy panel's "Agent memory" tab (plan W13.A3): when each agent read
 * AGENT-MEMORY.md and how many facts — never the facts themselves.
 */
import { getLocale, t } from "../i18n";
import { memoryReads } from "../agents/memory/agentMemory";
import "./agentMemoryStrings";

export default function MemoryReadsView() {
  const reads = [...memoryReads()].reverse();
  if (!reads.length) return <p style={{ padding: "12px 16px", margin: 0, fontSize: 13 }}>{t("agentMemory.reads.none")}</p>;
  return (
    <ul tabIndex={0} aria-label={t("agentMemory.reads.title")} style={{ margin: 0, padding: "8px 16px 8px 32px", fontSize: 12.5, overflow: "auto", flex: 1 }} data-testid="memory-reads">
      {reads.map((r, i) => (
        <li key={`${r.at}-${i}`}>{t("agentMemory.reads.row", { agent: r.agentId, n: r.facts, time: new Date(r.at).toLocaleString(getLocale()) })}</li>
      ))}
    </ul>
  );
}
