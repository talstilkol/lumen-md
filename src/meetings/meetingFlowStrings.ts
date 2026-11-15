/**
 * The meeting recorder's English strings travel with its lazy chunk
 * (src/i18n/lazy/meetingFlow.json), not the startup bundle (W11.I19).
 * Imported for its side effect by ./meetingFlow.ts and ./MeetingRecorder.tsx.
 */
import english from "../i18n/lazy/meetingFlow.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
