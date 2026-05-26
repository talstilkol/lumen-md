/**
 * Storage adapter for the web build.
 * Uses the File System Access API where supported, with a graceful fallback to
 * a hidden <input type="file"> + download trick for Save As.
 */
import { rtfToMarkdown, htmlToMarkdown, xmlToMarkdown } from "./fileFormats";

declare global {
  interface Window {
    showOpenFilePicker?: (
      options?: OpenFilePickerOptions,
    ) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (
      options?: SaveFilePickerOptions,
    ) => Promise<FileSystemFileHandle>;
  }
  interface OpenFilePickerOptions {
    types?: { description: string; accept: Record<string, string[]> }[];
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
  }
  interface SaveFilePickerOptions {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }
}

const MD_TYPES = [
  {
    description: "Markdown",
    accept: { "text/markdown": [".md", ".markdown"] as string[] },
  },
];
const DATA_TYPES = [
  {
    description: "Markdown / data",
    accept: {
      "text/markdown": [".md", ".markdown"] as string[],
      "text/plain": [".txt", ".rtf"] as string[],
      "text/csv": [".csv", ".tsv"] as string[],
      "text/html": [".html", ".htm"] as string[],
      "text/xml": [".xml"] as string[],
      "application/json": [".json"] as string[],
      "application/msword": [".doc"] as string[],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"] as string[],
    },
  },
];

export interface OpenedFile {
  name: string;
  content: string;
  handle?: FileSystemFileHandle;
}

export async function openFileDialog(): Promise<OpenedFile | null> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        excludeAcceptAllOption: false,
        types: DATA_TYPES,
      });
      const file = await handle.getFile();
      const raw = await file.text();
      return {
        name: file.name,
        content: convertImported(file.name, raw),
        handle,
      };
    } catch (e) {
      // user cancelled
      if ((e as Error).name === "AbortError") return null;
      throw e;
    }
  }
  // Fallback to <input type="file">
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.txt,.csv,.tsv,.json,.rtf,.doc,.docx,.html,.htm,.xml";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const raw = await f.text();
      resolve({ name: f.name, content: convertImported(f.name, raw) });
    };
    input.click();
  });
}

export async function saveFile(
  file: OpenedFile,
  options: { saveAs?: boolean } = {},
): Promise<OpenedFile> {
  // Try existing handle first.
  if (file.handle && !options.saveAs) {
    const handle = file.handle;
    if ("createWritable" in handle) {
      try {
        const writable = await handle.createWritable();
        await writable.write(file.content);
        await writable.close();
        return file;
      } catch {
        /* fall through to Save As */
      }
    }
  }

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: file.name || "document.md",
        types: MD_TYPES,
      });
      const writable = await handle.createWritable();
      await writable.write(file.content);
      await writable.close();
      return { ...file, handle, name: handle.name ?? file.name };
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw e;
    }
  }

  // Fallback: trigger a download.
  const blob = new Blob([file.content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name || "document.md";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return file;
}

/**
 * Convert imported CSV/JSON files into a small markdown stub that drops the
 * raw content into the corresponding Lumen block, so the auto-table+chart
 * engine kicks in immediately.
 *
 * Exported so tests can exercise the actual transformation rather than a
 * locally-reimplemented copy (which is theatre and can drift silently).
 */
export function convertImported(name: string, raw: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
    const lang = lower.endsWith(".tsv") ? "tsv" : "csv";
    return `# ${name}\n\n\`\`\`${lang} title="${name}"\n${raw.trim()}\n\`\`\`\n`;
  }
  if (lower.endsWith(".json")) {
    const trimmed = raw.trim();
    let isArray = false;
    try {
      isArray = Array.isArray(JSON.parse(trimmed));
    } catch {
      /* malformed json — keep as code block */
    }
    if (isArray) {
      return `# ${name}\n\n\`\`\`json-table title="${name}"\n${trimmed}\n\`\`\`\n`;
    }
    return `# ${name}\n\n\`\`\`json\n${trimmed}\n\`\`\`\n`;
  }
  if (lower.endsWith(".rtf")) {
    return `# ${name}\n\n${rtfToMarkdown(raw)}`;
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return htmlToMarkdown(raw);
  }
  if (lower.endsWith(".xml")) {
    return `# ${name}\n\n${xmlToMarkdown(raw)}`;
  }
  return raw;
}
