/**
 * Where questions come from, until the Question Bank service exists.
 *
 * game-core never knows about packs: it receives a list of Questions at START.
 * Choosing packs, filtering categories and skipping hidden questions all happen here.
 * Later this module's job moves behind an API with an admin UI; the interface stays the same.
 */
import type { Question } from "@family-party/game-core";
import type { PackInfo } from "@family-party/protocol";
import clasico from "../packs/clasico.json";
import type { Pick } from "@family-party/game-core";
import { allPicks as allPicksOf, catalog as catalogOf, picksExist as picksExistIn, selectQuestions as select, type Pack, type Selection } from "./pack";

export * from "./pack";

/**
 * Built-in packs: public trivia only, since this repo is public.
 * Personal packs (family questions, private events) will live in a private
 * S3 bucket instead, loaded by the Lambda at runtime. Never commit them here.
 */
export const PACKS: Pack[] = [clasico as Pack];

/** The questions a room may deal from. Hidden questions are never included. */
export function selectQuestions(selection: Selection = {}, packs: Pack[] = PACKS): Question[] {
  return select(selection, packs);
}

/** What the lobby shows: pack names and category sizes. Never includes answers. */
export function catalog(packs: Pack[] = PACKS): PackInfo[] {
  return catalogOf(packs);
}

/** Public packs, then any extra (private) packs unlocked in a room, marked as such. */
export function catalogWith(extra: Pack[] = []): PackInfo[] {
  return [...catalogOf(PACKS), ...catalogOf(extra).map((p) => ({ ...p, private: true }))];
}

/** A new room starts with every public category picked. */
export function defaultPicks(packs: Pack[] = PACKS): Pick[] {
  return allPicksOf(packs);
}

export function picksExist(picks: Pick[], packs: Pack[] = PACKS): boolean {
  return picksExistIn(picks, packs);
}
