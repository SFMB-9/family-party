import { describe, expect, it } from "vitest";
import { CONNECTION_TTL_SECONDS, MAX_MESSAGE_CHARS, expiresAt, makeEnvelope, managementEndpoint } from "./envelope";

describe("makeEnvelope", () => {
  it("stamps the server's time, not anything the client sent", () => {
    const e = makeEnvelope("abc", JSON.stringify({ at: 0, msg: "hola" }), 1_700_000_000_000);
    expect(e.at).toBe(1_700_000_000_000);
    expect(e.from).toBe("abc");
  });

  it("truncates oversized messages", () => {
    const e = makeEnvelope("abc", "x".repeat(MAX_MESSAGE_CHARS + 50), 0);
    expect(e.data).toHaveLength(MAX_MESSAGE_CHARS);
  });

  it("handles an empty body", () => {
    expect(makeEnvelope("abc", undefined, 0).data).toBe("");
  });
});

describe("managementEndpoint", () => {
  it("builds the callback URL from the event's domain and stage", () => {
    expect(managementEndpoint("abc123.execute-api.mx-central-1.amazonaws.com", "dev"))
      .toBe("https://abc123.execute-api.mx-central-1.amazonaws.com/dev");
  });
});

describe("expiresAt", () => {
  it("returns epoch seconds, which is what DynamoDB TTL expects", () => {
    expect(expiresAt(1_700_000_000_123)).toBe(1_700_000_000 + CONNECTION_TTL_SECONDS);
  });
});
