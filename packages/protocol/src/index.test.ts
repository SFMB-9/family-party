import { describe, expect, it } from "vitest";
import { isRoomCode, parseClientMessage } from "./index";

describe("parseClientMessage", () => {
  it("accepts well-formed messages", () => {
    expect(parseClientMessage('{"t":"hello"}')).toEqual({ t: "hello" });
    expect(parseClientMessage('{"t":"hello","token":"abc"}')).toEqual({ t: "hello", token: "abc" });
    expect(parseClientMessage('{"t":"join","name":"Ana"}')).toEqual({ t: "join", name: "Ana" });
    expect(parseClientMessage('{"t":"pick","cardId":"Historia-0"}')).toEqual({ t: "pick", cardId: "Historia-0" });
    expect(parseClientMessage('{"t":"answer","choice":2}')).toEqual({ t: "answer", choice: 2 });
    expect(parseClientMessage('{"t":"create","categories":["Historia"]}')).toEqual({ t: "create", categories: ["Historia"] });
  });

  it("drops fields the client has no business sending", () => {
    // A phone can't claim to be someone else or pick its own timestamp.
    expect(parseClientMessage('{"t":"answer","choice":1,"playerId":"ana","at":0}')).toEqual({ t: "answer", choice: 1 });
  });

  it.each([
    undefined,
    "",
    "not json",
    "[]",
    "null",
    '{"t":"nope"}',
    '{"t":"answer","choice":"2"}',
    '{"t":"pick"}',
    '{"t":"hello","token":42}',
    '{"t":"create","packs":"clasico"}',
    "x".repeat(5_000),
  ])("rejects %j", (raw) => {
    expect(parseClientMessage(raw)).toBeNull();
  });
});

describe("isRoomCode", () => {
  it("accepts 4 letters from the unambiguous alphabet", () => {
    expect(isRoomCode("ABCD")).toBe(true);
    expect(isRoomCode("XQZW")).toBe(true);
  });
  it.each(["abcd", "ABC", "ABCDE", "AB1D", "ABOD", "ABID", 1234, null])("rejects %j", (x) => {
    expect(isRoomCode(x)).toBe(false);
  });
});
