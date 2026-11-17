/**
 * Where the writing goals' daily log is kept (W13.W14): this device's
 * localStorage, every access guarded. Apart from the goal logic
 * (src/agents/writing/goals/goals.ts), which only computes, so that the
 * writing agents stay free of storage (W1's static check).
 */
import type { GoalLog } from "../agents/writing/goals/goals";

export const GOAL_LOG_KEY = "lumen.writingGoals.log.v1";

export function loadGoalLog(): GoalLog {
  try {
    const v = JSON.parse(localStorage.getItem(GOAL_LOG_KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as GoalLog) : {};
  } catch {
    // why: storage blocked or corrupt: start a new log
    return {};
  }
}

export function saveGoalLog(log: GoalLog): void {
  try {
    localStorage.setItem(GOAL_LOG_KEY, JSON.stringify(log));
  } catch {
    // why: storage blocked (private window): progress lasts for this session only
  }
}
