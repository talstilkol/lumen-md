export function fastSubset(log: string): string[];
export function prOfSubject(subject: string): number | null;
export function findCulprit(o: { repo: string; good: string; bad: string; cmd: string[]; firstParent?: boolean }): { culprit: string | null; subject?: string; pr?: number | null; merge?: boolean; steps: number; log?: string };
