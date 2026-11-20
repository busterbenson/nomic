import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCtx } from "promptocracy/engine/testing";
import rule from "./202.ts";

test("202 (throwing fixture): a proposal throws, a move does not", () => {
  const ctx = makeCtx({ players: [{ ref: "a", x: 0, y: 0 }] });
  assert.throws(() => rule.actionAllowed!(ctx, { ref: "a" }, { kind: "propose" }), /boom/);
  assert.equal(rule.actionAllowed!(ctx, { ref: "a" }, { kind: "move" }), null);
});
