/**
 * Augmentations for the File System Access API spec entries that are not yet
 * in TypeScript's lib.dom.d.ts (or are still flagged as experimental).
 */

interface FileSystemDirectoryHandle {
  /** Async iterator over [name, handle] pairs. */
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  /** Async iterator over child handles. */
  values(): AsyncIterableIterator<FileSystemHandle>;
  /** Async iterator over child names. */
  keys(): AsyncIterableIterator<string>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

interface FileSystemFileHandle {
  createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>;
}

interface FileSystemHandle {
  queryPermission?(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
}

interface Window {
  /** Web Speech API — Chrome-only as `webkitSpeechRecognition`. */
  webkitSpeechRecognition?: typeof SpeechRecognition;
  SpeechRecognition?: typeof SpeechRecognition;
}

declare class SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event & { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
