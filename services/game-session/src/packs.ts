/**
 * Private question packs: family questions that never live in the public repo.
 *
 * Each one is a JSON file in a private S3 bucket (packs/<id>.json): the usual pack format
 * plus an `access` block with a scrypt hash of its unlock code, never the code itself.
 * The host types the code in the lobby; a match unlocks that pack for that room only.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { PACKS, validatePack, type Pack } from "@family-party/question-bank";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number, options: object) => Promise<Buffer>;

/** How a code is checked. N = 2^14 takes tens of ms even on a small Lambda; codes are long passphrases. */
export interface Access {
  kdf: "scrypt";
  N: number;
  r: number;
  p: number;
  salt: string; // base64
  hash: string; // base64, 32 bytes
}

export interface PrivatePack {
  pack: Pack;
  access: Access;
}

/** Where private packs come from: S3 in the Lambda, a local folder in dev, a list in tests. */
export interface PackSource {
  list(): Promise<PrivatePack[]>;
}

export const MIN_CODE_LENGTH = 12;
const DEFAULTS = { N: 2 ** 14, r: 8, p: 1 };

/**
 * Codes look like something you redeem (TAMALESABUELA26) but are forgiving about how
 * they're typed: case, accents, spaces and punctuation are ignored, so
 * "tamales abuela 26" = "TAMALES-ABUELA-26" = "TamalesAbuela26".
 */
export function normalizeCode(code: string): string {
  return code
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // á → a, ñ → n (strip the combining accents NFKD split off)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ""); // letters and digits are all that count
}

/** How a code is shown and shared: one uppercase block. */
export const displayCode = (code: string) => normalizeCode(code).toUpperCase();

export async function hashCode(code: string, params = DEFAULTS): Promise<Access> {
  const salt = randomBytes(16);
  const hash = await derive(normalizeCode(code), salt, params);
  return { kdf: "scrypt", ...params, salt: salt.toString("base64"), hash: hash.toString("base64") };
}

export async function verifyCode(code: string, access: Access): Promise<boolean> {
  const expected = Buffer.from(access.hash, "base64");
  const actual = await derive(normalizeCode(code), Buffer.from(access.salt, "base64"), access);
  return actual.length === expected.length && timingSafeEqual(actual, expected); // no early exit to time
}

const derive = (code: string, salt: Buffer, { N, r, p }: { N: number; r: number; p: number }) =>
  scrypt(code, salt, 32, { N, r, p, maxmem: 128 * N * r * 2 });

/** A pack file from the bucket, checked before it's trusted. Returns the problems, or the pack. */
export function parsePrivatePack(json: unknown): { ok: true; value: PrivatePack } | { ok: false; errors: string[] } {
  if (typeof json !== "object" || json === null) return { ok: false, errors: ["not an object"] };
  const { access, ...pack } = json as Pack & { access?: Partial<Access> };
  const errors = Array.isArray(pack.questions) ? validatePack(pack as Pack) : ["questions must be a list"];
  if (PACKS.some((p) => p.id === pack.id)) errors.push(`${pack.id}: id clashes with a built-in pack`);
  const a = access ?? {};
  const validAccess =
    a.kdf === "scrypt" &&
    [a.N, a.r, a.p].every((n) => Number.isInteger(n) && (n as number) > 0) &&
    typeof a.salt === "string" &&
    typeof a.hash === "string";
  if (!validAccess) errors.push(`${pack.id ?? "?"}: missing or invalid access block (run lock-pack)`);
  return errors.length ? { ok: false, errors } : { ok: true, value: { pack: pack as Pack, access: a as Access } };
}
