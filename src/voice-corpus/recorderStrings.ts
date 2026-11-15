/**
 * The corpus recorder's English strings (plan W7.10, W10.E52) travel with its
 * lazy chunk (src/i18n/lazy/voiceCorpus.json), not the startup bundle.
 * Imported for its side effect by Recorder.tsx. The command's name
 * (cmd.voice.corpusRecorder) stays in the startup bundle: the palette lists it.
 */
import english from "../i18n/lazy/voiceCorpus.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
