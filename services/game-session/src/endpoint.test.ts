import { expect, it } from "vitest";
import { managementEndpoint } from "./endpoint";

it("builds the callback URL from the event's domain and stage", () => {
  expect(managementEndpoint("abc123.execute-api.mx-central-1.amazonaws.com", "dev"))
    .toBe("https://abc123.execute-api.mx-central-1.amazonaws.com/dev");
});
