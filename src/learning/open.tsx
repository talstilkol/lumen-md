/**
 * Opens the learning plans dialog (plan W12.H4) from the palette: reads
 * .lumen/learning.json from the vault, and writes it back on every change.
 * The dialog loads with a dynamic import, not at startup.
 */
import { createRoot, type Root } from "react-dom/client";
import { useAppStore } from "../store/useStore";
import { LEARNING_PATH, parseLearningFile, serializeLearningFile } from "./plans";

let mounted: { root: Root; host: HTMLElement } | null = null;

export function closeLearningPlans(): void {
  if (!mounted) return;
  mounted.root.unmount();
  mounted.host.remove();
  mounted = null;
}

export async function openLearningPlans(now = new Date()): Promise<void> {
  const [ws, { LearningPlansDialog }] = await Promise.all([import("../storage/workspace"), import("./LearningPlansDialog")]);
  const text = await ws.readWorkspaceFile(LEARNING_PATH).catch(() => null);
  closeLearningPlans();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted = { root, host };
  const lang = useAppStore.getState().locale === "he" ? "he" : "en";
  const today = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  root.render(
    <LearningPlansDialog
      file={parseLearningFile(text)}
      today={today}
      lang={lang}
      onClose={closeLearningPlans}
      onChange={async (f) => {
        await ws.writeWorkspaceFile(LEARNING_PATH, serializeLearningFile(f));
        window.dispatchEvent(new CustomEvent("lumen-workspace-changed"));
      }}
    />,
  );
}
