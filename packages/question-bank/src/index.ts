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
import familia from "../packs/familia.json";
import { catalog as catalogOf, selectQuestions as select, type Pack, type Selection } from "./pack";

export * from "./pack";

/** Built-in packs. To add one: drop a JSON file in packs/ and list it here. */
export const PACKS: Pack[] = [clasico as Pack, familia as Pack];

/** The questions a room may deal from. Hidden questions are never included. */
export function selectQuestions(selection: Selection = {}, packs: Pack[] = PACKS): Question[] {
  return select(selection, packs);
}

/** What the lobby shows: pack names and category sizes. Never includes answers. */
export function catalog(packs: Pack[] = PACKS): PackInfo[] {
  return catalogOf(packs);
}
