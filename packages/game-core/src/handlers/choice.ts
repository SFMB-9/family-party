import type { ChoiceSpec, PublicChoiceSpec } from "../types";
import { shuffle, type Rng } from "../random";

export const choiceHandler = {
  prepare(spec: ChoiceSpec, rng: Rng): ChoiceSpec {
    const order = shuffle(spec.options.map((_, i) => i), rng);
    const options = order.map((oldPos) => spec.options[oldPos]!);
    const correct = spec.correct.map((oldPos) => order.indexOf(oldPos));

    return { kind: "choice", options, correct };
  },
  redact(spec: ChoiceSpec): PublicChoiceSpec {
    return { kind: "choice", options: spec.options };
  },
  isValidAnswer(spec: ChoiceSpec, answer: unknown): answer is number {
    return (
      Number.isInteger(answer) &&
      (answer as number) >= 0 &&
      (answer as number) < spec.options.length
    );
  },
  isCorrect(spec: ChoiceSpec, answer: number): boolean {
    return spec.correct.includes(answer);
  }
};