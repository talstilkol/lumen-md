/** Opus-MT en → he through the app's MT layer (W10.E35), scored against the set's Hebrew side; see ../opus.ts. */
import { opusEngine } from "../opus";

export const engine = opusEngine("opus-en-he", { source: "en", target: "he" });
