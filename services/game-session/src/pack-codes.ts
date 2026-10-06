/**
 * Local codes file for `pack-sheet`: one entry per pack id, kept on Salva's PC OUTSIDE the repo
 * and outside private-packs/ (default ~/.family-party/codes.json, or PACK_CODES_FILE).
 *
 *   { "milanes-party": { "name": "Milanés Party", "code": "TAMALESABUELA26" } }
 *
 * The id is what keeps a pack single in the bucket (packs/<id>.json), so the file also works as the
 * list of known packs: an id that isn't in it is a new pack on purpose, not a typo.
 * Keys starting with "_" are notes and ignored.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { MIN_CODE_LENGTH, normalizeCode, verifyCode, type Access } from "./packs";

export interface CodeEntry {
  name: string;
  code: string;
}

export const codesPath = (env: Record<string, string | undefined> = process.env, home = homedir()) =>
  env.PACK_CODES_FILE || join(home, ".family-party", "codes.json");

/** Problems are reported by id and never include the code itself. */
export function parseCodes(json: unknown): { ok: true; value: Map<string, CodeEntry> } | { ok: false; errors: string[] } {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return { ok: false, errors: ["the file must be an object: { \"<pack id>\": { \"name\": …, \"code\": … } }"] };
  const value = new Map<string, CodeEntry>();
  const errors: string[] = [];
  for (const [id, entry] of Object.entries(json)) {
    if (id.startsWith("_")) continue;
    const e = entry as Partial<CodeEntry> | null;
    if (typeof e !== "object" || e === null || typeof e.name !== "string" || typeof e.code !== "string") {
      errors.push(`${id}: needs "name" and "code" (text)`);
      continue;
    }
    value.set(id, { name: e.name, code: e.code });
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

/** Why an entry can't be used yet, or null when it's ready. */
export function entryProblem(id: string, entry: CodeEntry | undefined): string | null {
  if (!entry) return `"${id}" isn't in the codes file. If it's a new pack, add it there first (that's what keeps ids from drifting into duplicate packs).`;
  const n = normalizeCode(entry.code).length;
  if (n === 0) return `"${id}" has no code yet: fill in "code" in the codes file.`;
  if (n < MIN_CODE_LENGTH) return `"${id}": the code is too short (${n} letters and digits, needs ${MIN_CODE_LENGTH}).`;
  return null;
}

export type CodeChange = "new" | "same" | "changed";

/** Compares the code about to be used with the hash already locked (local lock or the bucket's copy). */
export async function codeChange(code: string, previous: Access | undefined): Promise<CodeChange> {
  if (!previous) return "new";
  return (await verifyCode(code, previous)) ? "same" : "changed";
}
