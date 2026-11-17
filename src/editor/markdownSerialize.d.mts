// Types for ./markdownSerialize.mjs (#847 follow-up to W11.Q8).
import type { Handle, Options } from "mdast-util-to-markdown";

export function nestedEmphasis(base?: Handle): Handle;
export function nestedStrong(base?: Handle): Handle;
export function htmlAfterList(base?: Handle): Handle;
export function roundTripSafe<T extends Options>(options?: T): T;
