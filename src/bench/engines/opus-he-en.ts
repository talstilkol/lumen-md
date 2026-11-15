/** Opus-MT tc-big he → en through the app's MT layer (W10.E35); see ../opus.ts. */
import { opusEngine } from "../opus";

export const engine = opusEngine("opus-he-en", { source: "he", target: "en" });
