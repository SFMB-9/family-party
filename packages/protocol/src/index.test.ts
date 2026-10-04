import { describe, expect, it } from "vitest";
import { isRoomCode, parseClientMessage } from "./index";

describe("parseClientMessage", () => {
  it("accepts well-formed messages", () => {
    expect(parseClientMessage('{"t":"hello"}')).toEqual({ t: "hello" });
    expect(parseClientMessage('{"t":"end"}')).toEqual({ t: "end" });
    expect(parseClientMessage('{"t":"ping"}')).toEqual({ t: "ping" });
    expect(parseClientMessage('{"t":"unlock","code":"tamales de la abuela"}')).toEqual({ t: "unlock", code: "tamales de la abuela" });
    expect(parseClientMessage('{"t":"picks","picks":[{"pack":"clasico","category":"Historia","x":1}]}'))
      .toEqual({ t: "picks", picks: [{ pack: "clasico", category: "Historia" }] });
    expect(parseClientMessage('{"t":"rematch"}')).toEqual({ t: "rematch" });
    expect(parseClientMessage('{"t":"close"}')).toEqual({ t: "close" });
    expect(parseClientMessage('{"t":"encore"}')).toEqual({ t: "encore" });
    expect(parseClientMessage('{"t":"leave"}')).toEqual({ t: "leave" });
    expect(parseClientMessage('{"t":"rules","rules":{"steals":"off","columns":3,"mixed":true}}'))
      .toEqual({ t: "rules", rules: { steals: "off", columns: 3, mixed: true } });
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
    '{"t":"rules"}',
    '{"t":"unlock","code":"   "}',
    `{"t":"unlock","code":"${"x".repeat(101)}"}`,
    '{"t":"picks","picks":"Historia"}',
    '{"t":"picks","picks":[{"pack":"clasico"}]}',
    '{"t":"rules","rules":[1]}',
    '{"t":"rules","rules":{"columns":{"nested":1}}}',
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
