/**
 * Plan W11.I22 — Agent Skills conformance (research R4.17). A port of the
 * reference validator, `skills-ref validate`
 * (https://github.com/agentskills/agentskills, skills-ref/src/skills_ref/
 * validator.py at 83021e2b, Apache-2.0), with the same rules and messages:
 *
 *   - SKILL.md (or skill.md) starts with YAML frontmatter between `---` lines;
 *   - only name, description, license, allowed-tools, metadata, compatibility;
 *   - name: non-empty, NFKC, ≤ 64 characters, lowercase, letters, digits and
 *     hyphens, no leading, trailing or double hyphen, equal to its folder;
 *   - description: non-empty, ≤ 1024 characters;
 *   - compatibility: a string, ≤ 500 characters.
 *
 * The spec's progressive-disclosure guidance (a body under 500 lines and
 * about 5,000 tokens, references one level deep) comes back as warnings,
 * as the spec words it as advice. `skillsPrompt` is the metadata-only
 * block for a system prompt (skills-ref's `to_prompt`): name and
 * description, never a body.
 */
import YAML from "yaml";

export const MAX_SKILL_NAME_LENGTH = 64;
export const MAX_DESCRIPTION_LENGTH = 1024;
export const MAX_COMPATIBILITY_LENGTH = 500;
export const ALLOWED_FIELDS = Object.freeze(["name", "description", "license", "allowed-tools", "metadata", "compatibility"]);
export const MAX_BODY_LINES = 500;
export const MAX_BODY_TOKENS = 5000;

export interface SkillsRefResult {
  errors: string[];
  warnings: string[];
}

/** parse_frontmatter: the YAML mapping between the first two `---`, and the body after. */
export function parseFrontmatter(content: string): { metadata: Record<string, unknown>; body: string } {
  if (!content.startsWith("---")) throw new Error("SKILL.md must start with YAML frontmatter (---)");
  const parts = content.split("---");
  if (parts.length < 3) throw new Error("SKILL.md frontmatter not properly closed with ---");
  const yaml = parts[1];
  const body = parts.slice(2).join("---").trim();
  let data: unknown;
  try {
    data = YAML.parse(yaml);
  } catch (e) {
    throw new Error(`Invalid YAML in frontmatter: ${(e as Error).message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("SKILL.md frontmatter must be a YAML mapping");
  return { metadata: data as Record<string, unknown>, body };
}

const isAlnum = (c: string) => /^[\p{L}\p{N}]$/u.test(c);

function validateName(raw: unknown, dir: string | undefined): string[] {
  if (typeof raw !== "string" || !raw.trim()) return ["Field 'name' must be a non-empty string"];
  const errors: string[] = [];
  const name = raw.trim().normalize("NFKC");
  if ([...name].length > MAX_SKILL_NAME_LENGTH) errors.push(`Skill name '${name}' exceeds ${MAX_SKILL_NAME_LENGTH} character limit (${[...name].length} chars)`);
  if (name !== name.toLowerCase()) errors.push(`Skill name '${name}' must be lowercase`);
  if (name.startsWith("-") || name.endsWith("-")) errors.push("Skill name cannot start or end with a hyphen");
  if (name.includes("--")) errors.push("Skill name cannot contain consecutive hyphens");
  if (![...name].every((c) => isAlnum(c) || c === "-")) errors.push(`Skill name '${name}' contains invalid characters. Only letters, digits, and hyphens are allowed.`);
  if (dir !== undefined && dir.normalize("NFKC") !== name) errors.push(`Directory name '${dir}' must match skill name '${name}'`);
  return errors;
}

/** validate_metadata. `dir`: the skill's folder name, for the name check. */
export function validateMetadata(metadata: Record<string, unknown>, dir?: string): string[] {
  const errors: string[] = [];
  const extra = Object.keys(metadata).filter((k) => !ALLOWED_FIELDS.includes(k)).sort();
  if (extra.length) errors.push(`Unexpected fields in frontmatter: ${extra.join(", ")}. Only ${JSON.stringify([...ALLOWED_FIELDS].sort())} are allowed.`);
  if (!("name" in metadata)) errors.push("Missing required field in frontmatter: name");
  else errors.push(...validateName(metadata.name, dir));
  if (!("description" in metadata)) errors.push("Missing required field in frontmatter: description");
  else if (typeof metadata.description !== "string" || !metadata.description.trim()) errors.push("Field 'description' must be a non-empty string");
  else if (metadata.description.length > MAX_DESCRIPTION_LENGTH) errors.push(`Description exceeds ${MAX_DESCRIPTION_LENGTH} character limit (${metadata.description.length} chars)`);
  if ("compatibility" in metadata) {
    const c = metadata.compatibility;
    if (typeof c !== "string") errors.push("Field 'compatibility' must be a string");
    else if (c.length > MAX_COMPATIBILITY_LENGTH) errors.push(`Compatibility exceeds ${MAX_COMPATIBILITY_LENGTH} character limit (${c.length} chars)`);
  }
  return errors;
}

/** Rough token count (≈ 4 characters a token, as the spec's own estimate). */
const tokens = (s: string) => Math.ceil(s.length / 4);

/** validate(): one SKILL.md text and its folder name. */
export function validateSkill(content: string, dir?: string): SkillsRefResult {
  let parsed: ReturnType<typeof parseFrontmatter>;
  try {
    parsed = parseFrontmatter(content.replace(/\r\n/g, "\n"));
  } catch (e) {
    return { errors: [(e as Error).message], warnings: [] };
  }
  const warnings: string[] = [];
  const lines = parsed.body.split("\n").length;
  if (lines > MAX_BODY_LINES) warnings.push(`Body has ${lines} lines; the spec recommends under ${MAX_BODY_LINES} (move detail to references/)`);
  if (tokens(parsed.body) > MAX_BODY_TOKENS) warnings.push(`Body is about ${tokens(parsed.body)} tokens; the spec recommends under ${MAX_BODY_TOKENS}`);
  for (const m of parsed.body.matchAll(/\]\(((?:scripts|references|assets)\/[^)]+)\)/g)) {
    if (m[1].split("/").length > 2) warnings.push(`Reference ${m[1]} is more than one level deep`);
  }
  return { errors: validateMetadata(parsed.metadata, dir), warnings };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

/**
 * The `<available_skills>` block (skills-ref's to_prompt): only each skill's
 * name, description and location — the first stage of progressive
 * disclosure. A body enters a prompt only when its skill is activated
 * (run.ts `skillAgent`).
 */
export function skillsPrompt(skills: readonly { name: string; description: string; location?: string }[]): string {
  if (!skills.length) return "<available_skills>\n</available_skills>";
  const lines = ["<available_skills>"];
  for (const s of skills) lines.push("<skill>", "<name>", esc(s.name), "</name>", "<description>", esc(s.description), "</description>", "<location>", s.location ?? `skill://${s.name}`, "</location>", "</skill>");
  lines.push("</available_skills>");
  return lines.join("\n");
}
