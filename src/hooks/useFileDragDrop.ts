import { useEffect, useRef, useState } from "react";
import { type DocFile } from "../store/useStore";
import { importFile } from "../storage/fs";

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

      // Support multi-file drop: process each file through the shared
      // importer (handles every supported format incl. binary office files)
      // and concatenate.
      const firstName = files[0].name;
      const parts = await Promise.all(
        files.map(async (f) => (await importFile(f)).content),
      );

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

