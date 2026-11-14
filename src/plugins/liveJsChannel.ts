/**
 * The message channel between the live-js runner page and the app. It is a
 * module of its own so the runner bundle (public/runners/livejs-runner.js,
 * scripts/build-runners.mjs) holds only the runner, not the app side.
 */
export const RUNNER_CHANNEL = "lumen-livejs";

export type RunnerToApp =
  | { channel: typeof RUNNER_CHANNEL; kind: "ready" }
  | { channel: typeof RUNNER_CHANNEL; kind: "unavailable" }
  | { channel: typeof RUNNER_CHANNEL; kind: "message"; data: unknown }
  | { channel: typeof RUNNER_CHANNEL; kind: "error"; message: string };
