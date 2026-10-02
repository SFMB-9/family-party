/**
 * Pure helpers, kept apart from the handler so they can be unit-tested
 * without AWS. The handler is just glue around these.
 */

export const MAX_MESSAGE_CHARS = 1_000;
export const CONNECTION_TTL_SECONDS = 2 * 60 * 60; // 2h: cleans up connections whose $disconnect never arrived

/** What every client receives when someone sends a message. */
export interface Envelope {
  from: string;   // connection id of the sender
  at: number;     // SERVER time in epoch ms; never trust a client clock
  data: string;
}

/**
 * Wrap a raw client message for broadcast. The timestamp comes from the
 * server, not the client: same rule as player identity (see game-core design).
 */
export function makeEnvelope(from: string, rawBody: string | undefined, now: number): Envelope {
  const data = (rawBody ?? "").slice(0, MAX_MESSAGE_CHARS);
  return { from, at: now, data };
}

/**
 * The URL the Lambda uses to push messages back to clients
 * (the API Gateway "management" endpoint). It's built from the event,
 * so the same code works for any stage or domain.
 */
export function managementEndpoint(domainName: string, stage: string): string {
  return `https://${domainName}/${stage}`;
}

/** DynamoDB TTL attributes are epoch SECONDS, not milliseconds. */
export function expiresAt(nowMs: number, ttlSeconds = CONNECTION_TTL_SECONDS): number {
  return Math.floor(nowMs / 1000) + ttlSeconds;
}
