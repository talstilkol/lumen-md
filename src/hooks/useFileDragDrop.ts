import { useEffect, useRef, useState } from "react";
import { type DocFile } from "../store/useStore";

export function useFileDragDrop(setDoc: (doc: Partial<DocFile>) => void) {
  const [dragHover, setDragHover] = useState(false);
  const counterRef = useRef(0);

  useEffect(() => {
    function onDragEnter(e: DragEvent) {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
        counterRef.current++;
        setDragHover(true);
      }
    }

    function onDragOver(e: DragEvent) {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    }

    function onDragLeave(_e: DragEvent) {
      counterRef.current--;
      if (counterRef.current <= 0) {
        counterRef.current = 0;
        setDragHover(false);
      }
    }

    async function onDrop(e: DragEvent) {
      e.preventDefault();
      counterRef.current = 0;
      setDragHover(false);
      
      const files = Array.from(e.dataTransfer?.files || []);
      if (!files.length) return;

      // Support multi-file drop: process each file and concatenate
      const parts: string[] = [];
      let firstName = files[0].name;
      
      for (const f of files) {
        const raw = await f.text();
        const lower = f.name.toLowerCase();
        let content = raw;

        if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
          const lang = lower.endsWith(".tsv") ? "tsv" : "csv";
          content = `# ${f.name}\n\n\`\`\`${lang} title="${f.name}"\n${raw.trim()}\n\`\`\`\n`;
        } else if (lower.endsWith(".json")) {
          const trimmed = raw.trim();
          let isArray = false;
          try {
            isArray = Array.isArray(JSON.parse(trimmed));
          } catch {
            // ignore
          }
          content = isArray
            ? `# ${f.name}\n\n\`\`\`json-table title="${f.name}"\n${trimmed}\n\`\`\`\n`
            : `# ${f.name}\n\n\`\`\`json\n${trimmed}\n\`\`\`\n`;
        }
        
        parts.push(content);
      }

      const finalContent = parts.join("\n\n---\n\n");
      const finalName = files.length > 1 ? `${firstName} (+${files.length - 1})` : firstName;
      setDoc({ name: finalName, content: finalContent, handle: undefined, dirty: false });
    }

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);

    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [setDoc]);

  return { dragHover };
}

