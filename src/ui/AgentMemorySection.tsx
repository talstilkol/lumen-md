/**
 * Settings > AI: which agents may read AGENT-MEMORY.md (plan W13.A3). Off
 * for every agent until the user turns it on here; the file itself is a
 * note in the vault, edited like any other.
 */
import { useState } from "react";
import { t } from "../i18n";
import { EVAL_AGENTS } from "../agents/agentIds";
import { MEMORY_PATH, memoryReaders, setMemoryAccess } from "../agents/memory/agentMemory";
import "./agentMemoryStrings";

export default function AgentMemorySection({ captionStyle, mutedStyle }: { captionStyle: React.CSSProperties; mutedStyle: React.CSSProperties }) {
  const [readers, setReaders] = useState(() => memoryReaders());
  const toggle = (id: string, on: boolean) => {
    setMemoryAccess(id, on);
    setReaders(memoryReaders());
  };
  return (
    <>
      <div id="ai-set-memory" style={captionStyle}>{t("agentMemory.title")}</div>
      <div style={mutedStyle}>{t("agentMemory.intro", { file: MEMORY_PATH })}</div>
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 4 }}>
        <legend style={{ fontSize: 12, marginBottom: 4 }}>{t("agentMemory.readers")}</legend>
        {EVAL_AGENTS.map((id) => (
          <label key={id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
            <input type="checkbox" checked={readers.has(id)} onChange={(e) => toggle(id, e.target.checked)} data-testid={`memory-reader-${id}`} />
            <bdi>{id}</bdi>
          </label>
        ))}
      </fieldset>
    </>
  );
}
