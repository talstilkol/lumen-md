/**
 * Every writing agent (plan W13.W1): importing this registers them all.
 * A new agent adds one line here (W13.W6–W15 too), so the no-network test
 * and the eval suite see it.
 */
export { proofreaderHe, PROOFREADER_HE_ID } from "./proofreaderHe";
export { styleCoach, coachRules, STYLE_COACH_ID } from "./styleCoach";
export { toneShifter, TONE_SHIFTER_ID, TONES } from "./toneShifter";
export { concisionAgent, CONCISION_ID } from "./concision";
