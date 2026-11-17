export function parsePgm(buf: Buffer): { width: number; height: number; gray: Uint8Array };
export function toPgm(width: number, height: number, gray: ArrayLike<number>): Buffer;
export function cleanGray(gray: ArrayLike<number>, otsu: (g: ArrayLike<number>) => number): Uint8Array;
export function makeHandwritingTesseract(env?: Record<string, string | undefined>, deps?: { otsu?: (g: ArrayLike<number>) => number; decode?: (path: string) => Buffer; ocr?: (pgm: Buffer) => Promise<string> }): Promise<{ id: string; recognize(path: string): Promise<string> }>;
export default function make(): Promise<{ id: string; recognize(path: string): Promise<string> }>;
