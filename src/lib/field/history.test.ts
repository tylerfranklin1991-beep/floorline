import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { commit, initHistory, redo, undo } from "./history.ts";

describe("history", () => {
  it("undoes and redoes, and a new commit clears redo", () => {
    let h = initHistory(1);
    h = commit(h, 2);
    h = commit(h, 3);
    h = undo(h);
    assert.equal(h.present, 2);
    h = redo(h);
    assert.equal(h.present, 3);
    h = undo(undo(h));
    assert.equal(h.present, 1);
    assert.equal(undo(h), h);
    h = commit(h, 9);
    assert.equal(h.future.length, 0);
    assert.equal(redo(h), h);
  });
});
