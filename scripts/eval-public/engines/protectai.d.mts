export interface ProtectAiEngine { id: string; digest: string; labels: string[]; logits(texts: string[]): Promise<number[]> }
export function makeProtectAi(env?: Record<string, string | undefined>, deps?: { transformers?: unknown; digest?: string }): Promise<ProtectAiEngine>;
export default function make(): Promise<ProtectAiEngine>;
