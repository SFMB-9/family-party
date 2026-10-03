"use client";

import { useEffect, useRef, useState } from "react";
import type { Phase } from "@family-party/game-core";
import type { ClientMessage } from "@family-party/protocol";

/**
 * Seconds left on the current question, in the SERVER's timeline
 * (deadline is server time; clockOffset = serverTime - localTime).
 *
 * When it hits zero, this client pokes the server with "timeout". Every connected
 * client does this; the server accepts the first poke that arrives after its own
 * deadline and ignores the rest. A small random delay spreads the pokes out.
 */
export function useCountdown(phase: Phase | undefined, clockOffset: number, send: (m: ClientMessage) => void) {
  const deadline = phase?.kind === "answering" ? phase.deadline : null;
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  const poked = useRef<{ deadline: number; at: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Tick while a timed question is open.
  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => setNow(Date.now() + clockOffset), 200);
    return () => clearInterval(id);
  }, [deadline, clockOffset]);

  // Clear any pending poke when the question changes or the component unmounts.
  useEffect(() => () => clearTimeout(timer.current), [deadline]);

  // Poke once per deadline; if the phase hasn't moved 2.5s later (clock skew), poke again.
  useEffect(() => {
    if (deadline === null || now < deadline) return;
    const last = poked.current;
    if (last && last.deadline === deadline && now - last.at < 2_500) return;
    poked.current = { deadline, at: now };
    timer.current = setTimeout(() => send({ t: "timeout" }), 150 + Math.random() * 400);
  }, [deadline, now, send]);

  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
