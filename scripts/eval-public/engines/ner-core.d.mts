export interface Span { start: number; end: number; type: string }
export interface Offset { start: number; end: number }
export interface Piece { entity: string; word: string; score?: number }
export interface GlinerTokenizer { encode(s: string): number[]; cls: number; sep: number }
export interface GlinerFeeds { input_ids: number[]; attention_mask: number[]; words_mask: number[]; text_lengths: number[]; span_idx: number[]; span_mask: boolean[]; L: number; K: number }
export interface WordSpan { start: number; end: number; label: number; score: number }
export function words(text: string): Array<{ w: string; start: number; end: number }>;
export function joinTokens(tokens: string[]): { text: string; offsets: Offset[] };
export function typeOf(tag: string | undefined): string | null;
export function spansToBio(offsets: Offset[], spans: Span[]): string[];
export function bioToSpans(offsets: Offset[], tags: string[]): Span[];
export function alignPieces(text: string, pieces: Piece[], minScore?: number): Span[];
export function glinerInputs(tok: GlinerTokenizer, textWords: string[], labels: string[], maxWidth?: number): GlinerFeeds;
export function decodeGliner(logits: ArrayLike<number>, L: number, K: number, C: number, threshold?: number): WordSpan[];
export function fileDigest(path: string): Promise<string>;
