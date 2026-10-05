import { describe, expect, it } from "vitest";
import { isExpired } from "./dynamo";

describe("isExpired", () => {
  const now = 1_800_000_000;

  it("treats an item past its expiresAt as gone, even if DynamoDB still returns it", () => {
    expect(isExpired({ expiresAt: now - 1 }, now)).toBe(true);
    expect(isExpired({ expiresAt: now }, now)).toBe(true);
  });

  it("keeps live items and items without a TTL", () => {
    expect(isExpired({ expiresAt: now + 60 }, now)).toBe(false);
    expect(isExpired({}, now)).toBe(false);
  });
});
